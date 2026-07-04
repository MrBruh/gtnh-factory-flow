import { describe, expect, it } from "vitest";
import {
  clamp,
  countPolylineTurns,
  getDisplayRectCrossing,
  getPolylineSegments,
  getSegmentDistance,
  getSegmentRectOverlapLength,
  pointInBounds,
  scoreEdgeRoute,
  segmentsIntersect,
  type Point,
  type Rect,
} from "./routing";

describe("getSegmentRectOverlapLength", () => {
  const rect: Rect = { left: 20, right: 52, top: -16, bottom: 16 };

  it("returns the crossed length when a horizontal segment cuts through a rect", () => {
    const overlap = getSegmentRectOverlapLength({ x: 0, y: 0 }, { x: 200, y: 0 }, rect);
    expect(overlap).toBeCloseTo(32, 5);
  });

  it("returns the crossed length for a vertical segment", () => {
    const overlap = getSegmentRectOverlapLength({ x: 36, y: -100 }, { x: 36, y: 100 }, rect);
    expect(overlap).toBeCloseTo(32, 5);
  });

  it("returns 0 when the segment misses the rect entirely", () => {
    expect(getSegmentRectOverlapLength({ x: 0, y: 100 }, { x: 200, y: 100 }, rect)).toBe(0);
  });

  it("returns ~0 for a segment leaving the rect's edge outward", () => {
    // Starts exactly on the right edge and travels further right: no interior length.
    const overlap = getSegmentRectOverlapLength({ x: 52, y: 0 }, { x: 200, y: 0 }, rect);
    expect(overlap).toBeCloseTo(0, 5);
  });
});

describe("getPolylineSegments", () => {
  it("builds segments and drops near-zero-length steps", () => {
    const segments = getPolylineSegments([
      { x: 0, y: 0 },
      { x: 0, y: 0 }, // duplicate, dropped
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0].length).toBeCloseTo(10, 5);
    expect(segments[1].length).toBeCloseTo(5, 5);
  });
});

describe("countPolylineTurns", () => {
  it("counts 0 turns for a straight run", () => {
    expect(
      countPolylineTurns([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
    ).toBe(0);
  });

  it("counts an L as one turn and a U as two", () => {
    expect(
      countPolylineTurns([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe(1);
    expect(
      countPolylineTurns([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toBe(2);
  });
});

describe("getDisplayRectCrossing", () => {
  const slot: Rect = { left: 20, right: 52, top: -16, bottom: 16 };

  it("reports a hit and overlap length when a segment crosses a slot", () => {
    const { hits, overlapLength } = getDisplayRectCrossing(
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      [slot],
    );
    expect(hits).toBe(1);
    // 32px slot + 2 * DISPLAY_RECT_CLEARANCE (3) of expansion = 38.
    expect(overlapLength).toBeCloseTo(38, 5);
  });

  it("reports no crossing for a route that routes around the slot", () => {
    const { hits, overlapLength } = getDisplayRectCrossing(
      [
        { x: 0, y: 0 },
        { x: 0, y: 60 },
        { x: 200, y: 60 },
        { x: 200, y: 0 },
      ],
      [slot],
    );
    expect(hits).toBe(0);
    expect(overlapLength).toBe(0);
  });
});

describe("scoreEdgeRoute display-rectangle penalty (issue #10)", () => {
  // A neighbouring output slot sitting just to the right of the source slot.
  const siblingSlot: Rect = { left: 20, right: 52, top: -16, bottom: 16 };
  const straightAcross: Point[] = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  ];
  const routedAround: Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: 64 },
    { x: 200, y: 64 },
    { x: 200, y: 0 },
  ];

  it("prefers the straight route when there is nothing to avoid", () => {
    const straight = scoreEdgeRoute(straightAcross, [], [], []);
    const around = scoreEdgeRoute(routedAround, [], [], []);
    // Absent the penalty, the shorter, turn-free straight route wins.
    expect(straight).toBeLessThan(around);
  });

  it("flips to route around once the sibling slot is an obstacle", () => {
    const straight = scoreEdgeRoute(straightAcross, [], [], [siblingSlot]);
    const around = scoreEdgeRoute(routedAround, [], [], [siblingSlot]);
    // The display-rect crossing penalty now makes the straight route worse,
    // biasing the exit up/down and around the neighbouring output.
    expect(around).toBeLessThan(straight);
  });

  it("does not penalize a straight route that clears the display rects", () => {
    const farSlot: Rect = { left: 20, right: 52, top: 200, bottom: 232 };
    const withFar = scoreEdgeRoute(straightAcross, [], [], [farSlot]);
    const withNone = scoreEdgeRoute(straightAcross, [], [], []);
    expect(withFar).toBe(withNone);
  });
});

describe("scoreEdgeRoute determinism", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: 40 },
    { x: 120, y: 40 },
    { x: 120, y: 0 },
  ];
  const rectA: Rect = { left: 20, right: 52, top: -16, bottom: 16 };
  const rectB: Rect = { left: 60, right: 92, top: -16, bottom: 16 };

  it("is a pure function of its inputs", () => {
    expect(scoreEdgeRoute(points, [], [], [rectA, rectB])).toBe(
      scoreEdgeRoute(points, [], [], [rectA, rectB]),
    );
  });

  it("is independent of display-rect ordering", () => {
    expect(scoreEdgeRoute(points, [], [], [rectA, rectB])).toBe(
      scoreEdgeRoute(points, [], [], [rectB, rectA]),
    );
  });
});

describe("geometry primitives", () => {
  it("pointInBounds respects inclusive edges", () => {
    const rect: Rect = { left: 0, right: 10, top: 0, bottom: 10 };
    expect(pointInBounds({ x: 5, y: 5 }, rect)).toBe(true);
    expect(pointInBounds({ x: 0, y: 10 }, rect)).toBe(true);
    expect(pointInBounds({ x: 11, y: 5 }, rect)).toBe(false);
  });

  it("clamp bounds a value", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("segmentsIntersect detects a crossing and a miss", () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
    ).toBe(true);
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }),
    ).toBe(false);
  });

  it("getSegmentDistance is 0 for intersecting and positive for parallel segments", () => {
    expect(
      getSegmentDistance({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
    ).toBe(0);
    expect(
      getSegmentDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }),
    ).toBeCloseTo(5, 5);
  });
});
