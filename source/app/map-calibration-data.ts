export type CalibrationPoint = { x: number; y: number };
export type MapMeasurement = {
  layoutId: string;
  image: string;
  imageWidth: number;
  imageHeight: number;
  points: [CalibrationPoint, CalibrationPoint];
};
export type MapCalibration = {
  version: 1;
  referenceLabel: string;
  referenceMapSlug: string;
  measurements: Record<string, MapMeasurement>;
};

// A fraction of the native image width, independent of browser size or tool zoom.
export function getReferenceLength(measurement: MapMeasurement) {
  const [start, end] = measurement.points;
  return Math.hypot(end.x - start.x, (end.y - start.y) * measurement.imageHeight / measurement.imageWidth);
}

export function getCalibrationFactors(calibration: MapCalibration) {
  const reference = calibration.measurements[calibration.referenceMapSlug];
  if (!reference) return {};
  const referenceLength = getReferenceLength(reference);
  return Object.fromEntries(Object.entries(calibration.measurements).map(([slug, measurement]) => [
    slug, referenceLength / getReferenceLength(measurement),
  ]));
}

export const standardReferencePixels = 32;

export function getCalibratedReferenceView(calibration: MapCalibration, mapSlug: string, width: number, height: number, artworkScale = 1, fallbackZoom = 1) {
  const measurement = calibration.measurements[mapSlug];
  if (!measurement || width <= 0 || height <= 0) {
    return { defaultZoom: fallbackZoom, minimumZoom: fallbackZoom, maximumZoom: Math.max(3, fallbackZoom), mapMarkerScale: 1 };
  }
  const artworkAspectRatio = measurement.imageWidth / measurement.imageHeight;
  const displayedArtworkWidth = Math.max(width, height * artworkAspectRatio) * artworkScale;
  const defaultZoom = standardReferencePixels / (getReferenceLength(measurement) * displayedArtworkWidth);
  return { defaultZoom, minimumZoom: defaultZoom / 4, maximumZoom: defaultZoom * 4, mapMarkerScale: 1 / defaultZoom };
}

export function parseMapCalibration(value: unknown): MapCalibration {
  if (!value || typeof value !== "object") throw new Error("Invalid calibration file.");
  const data = value as Partial<MapCalibration>;
  if (data.version !== 1 || typeof data.referenceLabel !== "string" || typeof data.referenceMapSlug !== "string" || !data.measurements || typeof data.measurements !== "object" || Array.isArray(data.measurements)) {
    throw new Error("Invalid calibration file.");
  }
  for (const measurement of Object.values(data.measurements)) {
    if (!measurement || typeof measurement.layoutId !== "string" || typeof measurement.image !== "string" || !Number.isFinite(measurement.imageWidth) || measurement.imageWidth <= 0 || !Number.isFinite(measurement.imageHeight) || measurement.imageHeight <= 0 || !Array.isArray(measurement.points) || measurement.points.length !== 2 || measurement.points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) || getReferenceLength(measurement) <= 0) {
      throw new Error("The file contains an invalid reference measurement.");
    }
  }
  if (Object.keys(data.measurements).length && !Object.hasOwn(data.measurements, data.referenceMapSlug)) {
    throw new Error("The reference map is missing from the file.");
  }
  return {
    version: 1,
    referenceLabel: data.referenceLabel,
    referenceMapSlug: data.referenceMapSlug,
    measurements: data.measurements,
  };
}
