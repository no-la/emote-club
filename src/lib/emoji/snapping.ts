import { STAGE_SIZE } from "./model";

// Match each object edge to its canvas edge, and its center to the canvas center.
export function snapAxis(position: number, startPosition: number, boundsStart: number, size: number, threshold: number) {
  const start = boundsStart + position - startPosition;
  const candidates = [
    { delta: -start, guide: 0 },
    { delta: STAGE_SIZE / 2 - (start + size / 2), guide: STAGE_SIZE / 2 },
    { delta: STAGE_SIZE - (start + size), guide: STAGE_SIZE },
  ].filter(candidate => Math.abs(candidate.delta) <= threshold && position + candidate.delta >= 0 && position + candidate.delta <= STAGE_SIZE);
  candidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  const nearest = candidates[0];
  return nearest ? { position: position + nearest.delta, guide: nearest.guide } : { position, guide: null };
}
