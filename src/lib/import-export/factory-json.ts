import { ZodError } from "zod";
import { normalizeProjectFuelProfiles } from "../model/fuels";
import { exportedFactoryProjectSchema, factoryProjectSchema } from "../model/schemas";
import { PROJECT_SCHEMA_VERSION } from "../model/types";
import type { ExportedFactoryProject, FactoryProject } from "../model/types";
import { APP_NAME, buildResolvedPlan, deriveDatasetVersionId } from "./resolved-plan";

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
