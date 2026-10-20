import { MapCalibrationTool } from "../MapCalibrationTool";
import { tacticalMaps } from "../map-data";

export const metadata = { title: "R6 StratShare | Map Calibration" };

export default function MapCalibrationPage() {
  return <MapCalibrationTool maps={tacticalMaps} />;
}
