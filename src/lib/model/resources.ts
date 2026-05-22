import type {
  Recipe,
  RecipeOutput,
  ResourceAmount,
  ResourceFlow,
  ResourceKey,
  ResourceKind,
} from "./types";

export function makeResourceKey(kind: ResourceKind, resourceId: string): ResourceKey {
  return `${kind}:${resourceId}` as ResourceKey;
}

export function getResourceKey(resource: Pick<ResourceAmount, "kind" | "id">): ResourceKey {
  return makeResourceKey(resource.kind, resource.id);
}

export function parseResourceKey(key: ResourceKey): {
  kind: ResourceKind;
  resourceId: string;
} {
  const separatorIndex = key.indexOf(":");
  return {
    kind: key.slice(0, separatorIndex) as ResourceKind,
    resourceId: key.slice(separatorIndex + 1),
  };
}

export function resourceLabel(resource: Pick<ResourceAmount, "id" | "displayName">): string {
  return resource.displayName ?? resource.id;
}

export function formatRate(value: number, digits = 2): string {
  if (!Number.isFinite(value)) {
    return "unbounded";
  }

  if (Math.abs(value) >= 100) {
    return value.toFixed(0);
  }

  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }

  return value.toFixed(digits);
}

export function formatResourceRate(flow: ResourceFlow | undefined): string {
  if (!flow) {
    return "none";
  }

  const unit = flow.kind === "fluid" ? "L/s" : "/s";
  return `${flow.displayName ?? flow.resourceId} ${formatRate(flow.amountPerSecond)}${unit}`;
}

export function primaryOutput(recipe: Recipe): RecipeOutput | undefined {
  return recipe.outputs.find((output) => !output.byproduct) ?? recipe.outputs[0];
}

export function getChanceMultiplier(output: RecipeOutput): number {
  return output.chance ?? 1;
}

export function isRecipeInputConsumed(input: Pick<ResourceAmount, "id"> & { consumed?: boolean }): boolean {
  return input.consumed !== false;
}

export function resourceMatchesInput(
  resource: Pick<ResourceAmount, "kind" | "id">,
  input: Pick<ResourceAmount, "kind" | "id" | "alternatives">,
): boolean {
  if (resource.kind !== input.kind) {
    return false;
  }

  return (
    resource.id === input.id ||
    Boolean(input.alternatives?.some((alternative) => alternative.id === resource.id))
  );
}
