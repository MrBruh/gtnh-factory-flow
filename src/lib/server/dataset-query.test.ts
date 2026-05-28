import { describe, expect, it } from "vitest";
import {
  buildTextSearchIndex,
  queryTextSearchIndex,
  searchTokensMatch,
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
