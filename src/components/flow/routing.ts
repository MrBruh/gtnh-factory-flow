// Pure geometry + scoring helpers for edge routing.
//
// These functions are intentionally DOM-free so they can be unit tested in the
// Vitest "node" environment. FactoryFlow.tsx owns the DOM measurement (node and
// slot rectangles, viewport transforms) and feeds the resulting flow-space
// geometry into these helpers.
//
// The routing contract lives in AGENTS.md → "Routing Links": route candidates
// are scored (never hardcoded), scoring must be deterministic for the same graph
// state and independent of zoom level, and the scoring priorities below implement
// that spec:
//   - heavily penalize self-folding / backtracking routes
//   - minimize pixels crossing node/card rectangles AND slot display rectangles
//   - keep ~8px clearance from other links
//   - minimize link intersections, turn count, and total length
//
// Determinism note: nothing here reads wall-clock time, randomness, or zoom. The
// score is a pure function of the (already zoom-normalized, grid-snapped) inputs,
// so the chosen topology is stable across zoom in / zoom out.

export type Point = { x: number; y: number };
export type Rect = { left: number; right: number; top: number; bottom: number };
export type RouteSegment = { start: Point; end: Point; length: number };
export type ObstacleSegment = {
  edgeId: string;
  start: Point;
  end: Point;
  length: number;
};

// Target clearance from other links, and the expansion applied to foreign node
// rectangles when scoring. Kept here because scoreEdgeRoute is the primary user.
export const EDGE_LINK_CLEARANCE = 8;

// Slot/display rectangles are packed far more tightly than whole nodes, so they
// get their own small clearance to avoid merging neighbouring slots into one
// impassable block while still keeping wires off the icons/rates.
export const DISPLAY_RECT_CLEARANCE = 3;

// Scoring weights. Named so the relative priorities are explicit and testable.
const NODE_OVERLAP_WEIGHT = 25_000;
const NODE_HIT_WEIGHT = 5_000;
const DISPLAY_RECT_OVERLAP_WEIGHT = 18_000;
const DISPLAY_RECT_HIT_WEIGHT = 6_000;
const SELF_INTERSECTION_WEIGHT = 1_000_000;
const FOLD_BACK_WEIGHT = 750_000;
const SELF_OVERLAP_WEIGHT = 40_000;
const EDGE_OVERLAP_WEIGHT = 9_000;
const EDGE_INTERSECTION_WEIGHT = 80_000;
const EDGE_NEARNESS_WEIGHT = 2_500;
const TURN_WEIGHT = 700;

/**
 * Score a candidate orthogonal route. Lower is better.
 *
 * @param points        Polyline of the candidate route (flow-space coordinates).
 * @param nodeBounds    Rectangles of foreign nodes to route around (source/target
 *                      excluded by the caller).
 * @param existingEdgeSegments  Already-committed segments of lower-index edges,
 *                      used for the intersection/overlap/clearance penalties.
 * @param displayRects  Slot/label display rectangles belonging to the source and
 *                      target nodes (minus the connected slot). Crossing these is
 *                      the "wire runs over a neighbouring output icon" defect, so
 *                      it is penalized explicitly here rather than special-cased in
 *                      the endpoint picker. This is what biases output exits up/down
 *                      when a horizontal exit would cross a sibling slot.
 */
export function scoreEdgeRoute(
  points: Point[],
  nodeBounds: Rect[],
  existingEdgeSegments: ObstacleSegment[] = [],
  displayRects: Rect[] = [],
): number {
  const segments = getPolylineSegments(points);
  const length = segments.reduce((sum, segment) => sum + segment.length, 0);
  let nodeHits = 0;
  let nodeOverlapLength = 0;
  let displayHits = 0;
  let displayOverlapLength = 0;
  let edgeIntersections = 0;
  let edgeNearness = 0;
  let edgeOverlap = 0;
  let selfIntersections = 0;
  let selfOverlap = 0;
  let foldBacks = 0;

  for (const segment of segments) {
    for (const bounds of nodeBounds) {
      const overlapLength = getSegmentRectOverlapLength(
        segment.start,
        segment.end,
        expandBounds(bounds, EDGE_LINK_CLEARANCE),
      );
      if (overlapLength > 0) {
        nodeHits += 1;
        nodeOverlapLength += overlapLength;
      }
    }

    for (const rect of displayRects) {
      const overlapLength = getSegmentRectOverlapLength(
        segment.start,
        segment.end,
        expandBounds(rect, DISPLAY_RECT_CLEARANCE),
      );
      if (overlapLength > 0) {
        displayHits += 1;
        displayOverlapLength += overlapLength;
      }
    }

    for (const existing of existingEdgeSegments) {
      if (segment.length < 0.5 || existing.length < 0.5) {
        continue;
      }

      if (segmentsIntersect(segment.start, segment.end, existing.start, existing.end)) {
        edgeIntersections += 1;
      }

      edgeOverlap += getCollinearOverlapLength(segment, existing);

      const distance = getSegmentDistance(segment.start, segment.end, existing.start, existing.end);
      if (distance < EDGE_LINK_CLEARANCE) {
        edgeNearness += ((EDGE_LINK_CLEARANCE - distance) / EDGE_LINK_CLEARANCE) * segment.length;
      }
    }
  }

  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    const previousDirection = getSegmentUnitVector(previous);
    const currentDirection = getSegmentUnitVector(current);
    const dot = previousDirection.x * currentDirection.x + previousDirection.y * currentDirection.y;

    if (dot < -0.85) {
      foldBacks += 1;
    }
  }

  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 2; rightIndex < segments.length; rightIndex += 1) {
      if (leftIndex === 0 && rightIndex === segments.length - 1) {
        continue;
      }

      const left = segments[leftIndex];
      const right = segments[rightIndex];
      if (segmentsIntersect(left.start, left.end, right.start, right.end)) {
        selfIntersections += 1;
      }
      selfOverlap += getCollinearOverlapLength(left, right);
    }
  }

  const turns = countPolylineTurns(points);
  return (
    nodeOverlapLength * NODE_OVERLAP_WEIGHT +
    nodeHits * NODE_HIT_WEIGHT +
    displayOverlapLength * DISPLAY_RECT_OVERLAP_WEIGHT +
    displayHits * DISPLAY_RECT_HIT_WEIGHT +
    selfIntersections * SELF_INTERSECTION_WEIGHT +
    foldBacks * FOLD_BACK_WEIGHT +
    selfOverlap * SELF_OVERLAP_WEIGHT +
    edgeOverlap * EDGE_OVERLAP_WEIGHT +
    edgeIntersections * EDGE_INTERSECTION_WEIGHT +
    edgeNearness * EDGE_NEARNESS_WEIGHT +
    turns * TURN_WEIGHT +
    length
  );
}

/**
 * Total length of `points` (the union of its segments) that lies inside any of
 * `rects` (each expanded by `clearance`). Pure helper used both by scoreEdgeRoute
 * and directly in tests to reason about the slot-crossing penalty.
 */
export function getDisplayRectCrossing(
  points: Point[],
  rects: Rect[],
  clearance = DISPLAY_RECT_CLEARANCE,
) {
  let hits = 0;
  let overlapLength = 0;
  for (const segment of getPolylineSegments(points)) {
    for (const rect of rects) {
      const overlap = getSegmentRectOverlapLength(
        segment.start,
        segment.end,
        expandBounds(rect, clearance),
      );
      if (overlap > 0) {
        hits += 1;
        overlapLength += overlap;
      }
    }
  }
  return { hits, overlapLength };
}

export function getPolylineSegments(points: Point[]): RouteSegment[] {
  const segments: RouteSegment[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > 0.5) {
      segments.push({ start, end, length });
    }
  }

  return segments;
}

export function countPolylineTurns(points: Point[]) {
  let turns = 0;
  for (let index = 2; index < points.length; index += 1) {
    const previous = points[index - 2];
    const current = points[index - 1];
    const next = points[index];
    const previousHorizontal = Math.abs(previous.y - current.y) < 0.5;
    const nextHorizontal = Math.abs(current.y - next.y) < 0.5;
    if (previousHorizontal !== nextHorizontal) {
      turns += 1;
    }
  }
  return turns;
}

export function getSegmentUnitVector(segment: RouteSegment) {
  return {
    x: (segment.end.x - segment.start.x) / segment.length,
    y: (segment.end.y - segment.start.y) / segment.length,
  };
}

export function expandBounds(bounds: Rect, amount: number): Rect {
  return {
    left: bounds.left - amount,
    right: bounds.right + amount,
    top: bounds.top - amount,
    bottom: bounds.bottom + amount,
  };
}

/**
 * Length of the segment start→end that lies inside `bounds` (Liang–Barsky clip).
 * Returns 0 when the segment misses the rectangle entirely.
 */
export function getSegmentRectOverlapLength(start: Point, end: Point, bounds: Rect) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let entry = 0;
  let exit = 1;

  const clips = [
    { p: -deltaX, q: start.x - bounds.left },
    { p: deltaX, q: bounds.right - start.x },
    { p: -deltaY, q: start.y - bounds.top },
    { p: deltaY, q: bounds.bottom - start.y },
  ];

  for (const { p, q } of clips) {
    if (Math.abs(p) < 0.0001) {
      if (q < 0) {
        return 0;
      }
      continue;
    }

    const ratio = q / p;
    if (p < 0) {
      entry = Math.max(entry, ratio);
    } else {
      exit = Math.min(exit, ratio);
    }

    if (entry > exit) {
      return 0;
    }
  }

  return Math.hypot(deltaX, deltaY) * Math.max(0, exit - entry);
}

export function pointInBounds(point: Point, bounds: Rect) {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

export function segmentsIntersect(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
) {
  const d1 = direction(secondStart, secondEnd, firstStart);
  const d2 = direction(secondStart, secondEnd, firstEnd);
  const d3 = direction(firstStart, firstEnd, secondStart);
  const d4 = direction(firstStart, firstEnd, secondEnd);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return (
    (Math.abs(d1) < 0.001 && pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (Math.abs(d2) < 0.001 && pointOnSegment(firstEnd, secondStart, secondEnd)) ||
    (Math.abs(d3) < 0.001 && pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (Math.abs(d4) < 0.001 && pointOnSegment(secondEnd, firstStart, firstEnd))
  );
}

function direction(start: Point, end: Point, point: Point) {
  return (point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x);
}

function pointOnSegment(point: Point, start: Point, end: Point) {
  return (
    point.x >= Math.min(start.x, end.x) - 0.001 &&
    point.x <= Math.max(start.x, end.x) + 0.001 &&
    point.y >= Math.min(start.y, end.y) - 0.001 &&
    point.y <= Math.max(start.y, end.y) + 0.001
  );
}

export function getClosestPointOnSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared <= 0
      ? 0
      : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const closest = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };
  const distanceX = point.x - closest.x;
  const distanceY = point.y - closest.y;

  return {
    point: closest,
    distanceSquared: distanceX * distanceX + distanceY * distanceY,
  };
}

export function getSegmentDistance(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
) {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
    return 0;
  }

  return Math.sqrt(
    Math.min(
      getClosestPointOnSegment(firstStart, secondStart, secondEnd).distanceSquared,
      getClosestPointOnSegment(firstEnd, secondStart, secondEnd).distanceSquared,
      getClosestPointOnSegment(secondStart, firstStart, firstEnd).distanceSquared,
      getClosestPointOnSegment(secondEnd, firstStart, firstEnd).distanceSquared,
    ),
  );
}

export function getCollinearOverlapLength(
  first: { start: Point; end: Point },
  second: { start: Point; end: Point },
) {
  const firstHorizontal = Math.abs(first.start.y - first.end.y) < 0.5;
  const secondHorizontal = Math.abs(second.start.y - second.end.y) < 0.5;
  const firstVertical = Math.abs(first.start.x - first.end.x) < 0.5;
  const secondVertical = Math.abs(second.start.x - second.end.x) < 0.5;

  if (firstHorizontal && secondHorizontal && Math.abs(first.start.y - second.start.y) < 0.5) {
    return getRangeOverlapLength(first.start.x, first.end.x, second.start.x, second.end.x);
  }

  if (firstVertical && secondVertical && Math.abs(first.start.x - second.start.x) < 0.5) {
    return getRangeOverlapLength(first.start.y, first.end.y, second.start.y, second.end.y);
  }

  return 0;
}

function getRangeOverlapLength(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  const firstMin = Math.min(firstStart, firstEnd);
  const firstMax = Math.max(firstStart, firstEnd);
  const secondMin = Math.min(secondStart, secondEnd);
  const secondMax = Math.max(secondStart, secondEnd);
  return Math.max(0, Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
