// Stored points use the artwork's 16:9 plane, independently of the viewport.
export const mapCoordinateAspectRatio = 16 / 9;
export const mapCoordinateSpace = "artwork-v2";

type Point = { x: number; y: number };
type Viewport = { aspectRatio?: number; coordinateSpace?: string; width?: number; height?: number };
type ArtworkTransform = { scale?: number; x?: number; y?: number };

// This is the only legacy conversion. Never clamp saved points to a cropped viewport.
export function toArtworkPoint(point: Point, viewport?: Viewport, transform?: ArtworkTransform): Point {
  if (viewport?.coordinateSpace === mapCoordinateSpace) return { x: point.x, y: point.y };
  const p = projectMapPoint(point, getMapProjectionScale(Number(viewport?.aspectRatio), mapCoordinateAspectRatio));
  const scale = transform?.scale ?? 1;
  // Older exports did not record viewport dimensions; use a stable reference for
  // their small pixel offsets. Exact recovery is only possible when dimensions exist.
  const width = viewport?.width && viewport.width > 0 ? viewport.width : 1600;
  const height = viewport?.height && viewport.height > 0 ? viewport.height : width / mapCoordinateAspectRatio;
  return { x: 50 + (p.x - 50 - (transform?.x ?? 0) / width * 100) / scale,
    y: 50 + (p.y - 50 - (transform?.y ?? 0) / height * 100) / scale };
}

export function pointOnMapPlane(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Point | null {
  if (!(rect.width > 0 && rect.height > 0) || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  return { x: Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100)),
    y: Math.max(0, Math.min(100, (clientY - rect.top) / rect.height * 100)) };
}

export function getMapProjectionScale(sourceAspectRatio: number, targetAspectRatio: number) {
  const scales = (aspect: number) => {
    const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : mapCoordinateAspectRatio;
    return { x: Math.max(1, mapCoordinateAspectRatio / ratio), y: Math.max(1, ratio / mapCoordinateAspectRatio) };
  };
  const source = scales(sourceAspectRatio);
  const target = scales(targetAspectRatio);
  return { x: target.x / source.x, y: target.y / source.y };
}

export function projectMapPoint(point: { x: number; y: number }, scale: { x: number; y: number }) {
  // Points outside a cropped viewport must stay outside, not stick to its edge.
  return { x: 50 + (point.x - 50) * scale.x, y: 50 + (point.y - 50) * scale.y };
}
