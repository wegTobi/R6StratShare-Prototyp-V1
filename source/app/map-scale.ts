import calibrationJson from "./map-calibration.json" with { type: "json" };
import { getCalibratedReferenceView, parseMapCalibration } from "./map-calibration-data";

export const mapCalibration = parseMapCalibration(calibrationJson);

// Only the outer viewing transform changes. Artwork and saved map coordinates stay intact.
export function getCalibratedMapView(mapSlug: string, width: number, height: number, artworkScale = 1, fallbackZoom = 1) {
  return getCalibratedReferenceView(mapCalibration, mapSlug, width, height, artworkScale, fallbackZoom);
}
