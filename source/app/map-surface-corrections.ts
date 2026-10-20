import correctionsJson from "./map-surface-corrections.json" with { type: "json" };
import type { MapSurface } from "./map-surfaces";

const corrections = correctionsJson as Record<string, Record<string, number>>;

export function applySurfaceCorrections(layoutId: string, features: MapSurface[]): MapSurface[] {
  const layoutCorrections = corrections[layoutId];
  if (!layoutCorrections) return features;
  for (const id of Object.keys(layoutCorrections)) {
    if (!features.some(feature => feature.id === id)) {
      throw new Error(`Reviewed surface is missing: ${layoutId}/${id}`);
    }
  }
  return features.flatMap(surface => {
    const count = layoutCorrections[surface.id];
    if (!count) return [surface];
    if (count === 1) return [{ ...surface, needsReview: false }];
    const [a, b, c, d] = surface.points;
    const horizontal = Math.hypot(b.x-a.x, b.y-a.y) > Math.hypot(d.x-a.x, d.y-a.y);
    const between = (start: typeof a, end: typeof a, fraction: number) => ({
      x: Number((start.x + (end.x-start.x)*fraction).toFixed(4)),
      y: Number((start.y + (end.y-start.y)*fraction).toFixed(4)),
    });
    return Array.from({ length: count }, (_, index) => {
      const start = index/count, end = (index+1)/count;
      return {
        ...surface,
        id: `${surface.id}/panel-${index+1}`,
        legacySurfaceId: surface.id,
        needsReview: false,
        points: horizontal
          ? [between(a,b,start), between(a,b,end), between(d,c,end), between(d,c,start)]
          : [between(a,d,start), between(b,c,start), between(b,c,end), between(a,d,end)],
      };
    });
  });
}
