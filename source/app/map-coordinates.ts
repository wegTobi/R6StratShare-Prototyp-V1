// Stored points use the artwork's 16:9 plane, independently of the viewport.
export const mapCoordinateAspectRatio = 16 / 9;

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
