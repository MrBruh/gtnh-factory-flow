import { describe, expect, it } from "vitest";
import { buildRecipeContentIndex } from "@/lib/model/recipe-content";
import type { Recipe } from "@/lib/model/types";
import {
  buildTextSearchIndex,
  matchRefsByContent,
  queryTextSearchIndex,
  searchTokensMatch,
  type DatasetRecipeRef,
} from "./dataset-query";

describe("dataset query text search", () => {
  it("matches substrings inside tokens without matching across token boundaries", () => {
    const index = buildTextSearchIndex(["Hydrogen Sulfide"], [0]);

    const sulfideCandidates = queryTextSearchIndex(index, ["ulfide"]) ?? [0];
    expect(sulfideCandidates).toContain(0);
    expect(searchTokensMatch(index.tokensByEntry[0] ?? [], ["ulfide"])).toBe(true);

    const crossBoundaryCandidates = queryTextSearchIndex(index, ["nsu"]) ?? [0];
    expect(crossBoundaryCandidates).not.toContain(0);
    expect(searchTokensMatch(index.tokensByEntry[0] ?? [], ["nsu"])).toBe(false);
  });
});

describe("resolving imported recipe refs by content", () => {
  const nitrobenzene = (id: string, overrides: Partial<Recipe> = {}): Recipe => ({
    id,
    name: "Chemical Plant: Nitrobenzene",
    machineType: "Chemical Plant",
    minimumTier: "HV",
    durationTicks: 600,
    eut: 480,
    inputs: [
      { kind: "fluid", id: "benzene", amount: 5000 },
      { kind: "fluid", id: "nitricacid", amount: 5000 },
    ],
    outputs: [{ kind: "fluid", id: "nitrobenzene", amount: 5000 }],
    source: { datasetVersionId: "stable-2.8.4", recipeMap: "Chemical Plant" },
    ...overrides,
  });

  const refFor = (recipe: Recipe, options: { withContent?: boolean } = {}): DatasetRecipeRef => ({
    id: recipe.id,
    name: recipe.name,
    machineType: recipe.machineType,
    recipeMap: recipe.source?.recipeMap,
    rawRecipeId: recipe.source?.rawRecipeId,
    outputs: recipe.outputs.map((output) => ({ kind: output.kind, id: output.id })),
    ...(options.withContent === false ? {} : { content: recipe }),
  });

  it("re-points a plan recipe whose dataset id moved between builds", () => {
    const index = buildRecipeContentIndex([nitrobenzene("regenerated-id")]);
    const matches = matchRefsByContent([refFor(nitrobenzene("stale-id"))], index);

    expect(matches.get("stale-id")).toBe("regenerated-id");
  });

  it("matches through a slot reorder, since content keys ignore slot order", () => {
    const index = buildRecipeContentIndex([
      nitrobenzene("regenerated-id", {
        inputs: [
          { kind: "fluid", id: "nitricacid", amount: 5000 },
          { kind: "fluid", id: "benzene", amount: 5000 },
        ],
      }),
    ]);
    const matches = matchRefsByContent([refFor(nitrobenzene("stale-id"))], index);

    expect(matches.get("stale-id")).toBe("regenerated-id");
  });

  it("refuses to guess when several dataset recipes share the content", () => {
    const index = buildRecipeContentIndex([
      nitrobenzene("candidate-a"),
      nitrobenzene("candidate-b"),
    ]);
    const matches = matchRefsByContent([refFor(nitrobenzene("stale-id"))], index);

    expect(matches.size).toBe(0);
  });

  it("refuses to collapse two plan recipes onto one dataset recipe", () => {
    const index = buildRecipeContentIndex([nitrobenzene("regenerated-id")]);
    const matches = matchRefsByContent(
      [refFor(nitrobenzene("stale-a")), refFor(nitrobenzene("stale-b"))],
      index,
    );

    expect(matches.size).toBe(0);
  });

  it("reports nothing for a recipe the dataset no longer carries", () => {
    const index = buildRecipeContentIndex([nitrobenzene("regenerated-id")]);
    const matches = matchRefsByContent(
      [refFor(nitrobenzene("stale-id", { outputs: [{ kind: "fluid", id: "phenol", amount: 1 }] }))],
      index,
    );

    expect(matches.size).toBe(0);
  });

  it("ignores refs from clients that send no content block", () => {
    const index = buildRecipeContentIndex([nitrobenzene("regenerated-id")]);
    const matches = matchRefsByContent(
      [refFor(nitrobenzene("stale-id"), { withContent: false })],
      index,
    );

    expect(matches.size).toBe(0);
  });

  it("does not emit a self-match when the id is already current", () => {
    const index = buildRecipeContentIndex([nitrobenzene("current-id")]);
    const matches = matchRefsByContent([refFor(nitrobenzene("current-id"))], index);

    expect(matches.size).toBe(0);
  });
});
