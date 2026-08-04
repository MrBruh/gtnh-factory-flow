import { ZodError } from "zod";
import { normalizeProjectFuelProfiles } from "../model/fuels";
import { buildRecipeContentIndex, recipeContentKey } from "../model/recipe-content";
import type { DatasetRecipeContentRef, RecipeContentIndex } from "../model/recipe-content";
import { exportedFactoryProjectSchema, factoryProjectSchema } from "../model/schemas";
import { PROJECT_SCHEMA_VERSION } from "../model/types";
import type { ExportedFactoryProject, FactoryProject, Recipe } from "../model/types";
import { APP_NAME, buildResolvedPlan, deriveDatasetVersionId } from "./resolved-plan";

export {
  buildRecipeContentIndex,
  recipeContentKey,
  type DatasetRecipeContentRef,
  type RecipeContentIndex,
  type RecipeContentRef,
} from "../model/recipe-content";

export class FactoryJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactoryJsonError";
  }
}

export interface SerializeFactoryProjectOptions {
  /** ISO timestamp stamped into `app.exportedAt`. Defaults to now. */
  exportedAt?: string;
  /** App version recorded under `app.version`. */
  appVersion?: string;
  /** Forwarded to the throughput solver for `resolved.generatedAt`. */
  generatedAt?: string;
}

/**
 * Normalize an older plan document to the current schema version. v1 -> v2 is
 * purely additive (the v2-only fields are optional), so the migration is just a
 * version bump; the strict `factoryProjectSchema` then validates the rest.
 */
export function migrateFactoryProjectRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }

  const record = raw as Record<string, unknown>;
  if (record.schemaVersion === 1) {
    return { ...record, schemaVersion: PROJECT_SCHEMA_VERSION };
  }

  return raw;
}

export interface RecipeIdMigrationReport {
  /** Plan recipes whose id was re-pointed at the dataset's current id for the same content. */
  migrated: Array<{ fromId: string; toId: string; name: string }>;
  /** Plan recipes with no dataset counterpart. Their embedded copy is kept as-is. */
  unmatched: Array<{ id: string; name: string }>;
  /**
   * Plan recipes whose content matches more than one dataset recipe, or that share their content
   * with another plan recipe. Left untouched rather than bound to an arbitrary row.
   */
  ambiguous: Array<{ id: string; name: string; candidateIds: string[] }>;
}

export interface RecipeIdMigrationResult extends RecipeIdMigrationReport {
  project: FactoryProject;
  /** True when at least one recipe id changed. */
  changed: boolean;
}

/**
 * Re-point an imported plan's recipe ids at the dataset recipes that carry the same content.
 *
 * Only ids the dataset does not already contain are considered, so a plan that still resolves is
 * never rewritten. An id is rewritten only when exactly one plan recipe and exactly one dataset
 * recipe share a content key; every other outcome is reported and left alone, so this can neither
 * bind a node to an arbitrary row nor collapse two plan recipes into one.
 *
 * Unmatched recipes keep their embedded copy rather than being marked missing: the plan carries
 * full recipe bodies, so it still renders and solves, and a dataset-side change should not break a
 * plan that opened yesterday. Callers should surface {@link RecipeIdMigrationReport} instead of
 * migrating silently.
 *
 * This re-points ids only. It does *not* swap in the matched dataset recipe bodies, and a content
 * key ignores slot order, so a caller that also adopts the dataset body must repair slot-indexed
 * references itself - edge handles embed a slot index. The app's import path does exactly that
 * (`hydrateImportedProjectRecipes` -> `remapMigratedRecipeReferences` in `TopBar`), and resolves
 * content matches server-side so the browser never loads every dataset recipe body; this function
 * is the standalone primitive for consumers that already hold the dataset in memory.
 */
export function migrateProjectRecipeIds(
  project: FactoryProject,
  dataset: RecipeContentIndex | Iterable<DatasetRecipeContentRef>,
): RecipeIdMigrationResult {
  const index = dataset instanceof Map ? dataset : buildRecipeContentIndex(dataset);
  const datasetIds = new Set<string>();
  for (const ids of index.values()) {
    for (const id of ids) {
      datasetIds.add(id);
    }
  }

  const report: RecipeIdMigrationReport = { migrated: [], unmatched: [], ambiguous: [] };
  const unresolved = project.recipes.filter((recipe) => !datasetIds.has(recipe.id));

  // Group first: two plan recipes sharing one content key have no non-arbitrary pairing.
  const unresolvedByContentKey = new Map<string, Recipe[]>();
  for (const recipe of unresolved) {
    const key = recipeContentKey(recipe);
    const group = unresolvedByContentKey.get(key);
    if (group) {
      group.push(recipe);
    } else {
      unresolvedByContentKey.set(key, [recipe]);
    }
  }

  const idMigration = new Map<string, string>();
  for (const [key, group] of unresolvedByContentKey) {
    const candidateIds = index.get(key) ?? [];

    if (candidateIds.length === 0) {
      for (const recipe of group) {
        report.unmatched.push({ id: recipe.id, name: recipe.name });
      }
      continue;
    }

    if (candidateIds.length > 1 || group.length > 1) {
      for (const recipe of group) {
        report.ambiguous.push({
          id: recipe.id,
          name: recipe.name,
          candidateIds: [...candidateIds],
        });
      }
      continue;
    }

    const [recipe] = group;
    const [toId] = candidateIds;
    if (!recipe || !toId) {
      continue;
    }
    idMigration.set(recipe.id, toId);
    report.migrated.push({ fromId: recipe.id, toId, name: recipe.name });
  }

  if (idMigration.size === 0) {
    return { ...report, project, changed: false };
  }

  return {
    ...report,
    changed: true,
    project: {
      ...project,
      // Node edges reference node ids, and their handles are resource-keyed, so re-pointing the
      // recipe id is enough - no edge or input-override rewiring is needed.
      recipes: project.recipes.map((recipe) => {
        const toId = idMigration.get(recipe.id);
        return toId ? { ...recipe, id: toId } : recipe;
      }),
      nodes: project.nodes.map((node) => {
        const toId = idMigration.get(node.recipeId);
        return toId ? { ...node, recipeId: toId } : node;
      }),
    },
  };
}

export function parseFactoryProjectJson(source: string): FactoryProject {
  let raw: unknown;

  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new FactoryJsonError(
      `Invalid JSON: ${error instanceof Error ? error.message : "Unknown parse error"}`,
    );
  }

  try {
    // The base schema strips export-only fields (datasetVersionId, app, resolved),
    // so the in-memory model stays the canonical editable plan.
    return normalizeProjectFuelProfiles(factoryProjectSchema.parse(migrateFactoryProjectRaw(raw)));
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
      throw new FactoryJsonError(`Invalid factory project: ${issues}`);
    }

    throw error;
  }
}

export function serializeFactoryProject(
  project: FactoryProject,
  options: SerializeFactoryProjectOptions = {},
): string {
  const normalized = normalizeProjectFuelProfiles(project);
  const exported: ExportedFactoryProject = {
    ...normalized,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    datasetVersionId: deriveDatasetVersionId(normalized),
    app: {
      name: APP_NAME,
      version: options.appVersion,
      exportedAt: options.exportedAt ?? new Date().toISOString(),
    },
    resolved: buildResolvedPlan(normalized, { generatedAt: options.generatedAt }),
  };
  const validatedProject = exportedFactoryProjectSchema.parse(exported);
  return `${JSON.stringify(validatedProject, null, 2)}\n`;
}

export function cloneImportedProject(project: FactoryProject): FactoryProject {
  return {
    ...project,
    metadata: {
      ...project.metadata,
      updatedAt: new Date().toISOString(),
    },
  };
}
