"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { TacticalMap } from "./map-data";
import { getCalibrationFactors, getReferenceLength, parseMapCalibration } from "./map-calibration-data";
import type { CalibrationPoint, MapCalibration, MapMeasurement } from "./map-calibration-data";
import styles from "./MapCalibrationTool.module.css";

const storageKey = "r6-stratshare-map-calibration-v1";
const emptyCalibration: MapCalibration = { version: 1, referenceLabel: "Hatch edge", referenceMapSlug: "", measurements: {} };

export function MapCalibrationTool({ maps }: { maps: TacticalMap[] }) {
  const [calibration, setCalibration] = useState<MapCalibration>(emptyCalibration);
  const [mapSlug, setMapSlug] = useState(maps[0].slug);
  const [layoutId, setLayoutId] = useState(maps[0].layouts[0].id);
  const [points, setPoints] = useState<CalibrationPoint[]>([]);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [status, setStatus] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);
  const selectedMap = maps.find(map => map.slug === mapSlug) ?? maps[0];
  const layout = selectedMap.layouts.find(item => item.id === layoutId) ?? selectedMap.layouts[0];
  const image = layout.floorImage ?? layout.image;
  const saved = calibration.measurements[mapSlug];
  const completed = maps.filter(map => calibration.measurements[map.slug]);
  const factors = getCalibrationFactors(calibration);
  const measurement: MapMeasurement | null = dimensions && points.length === 2 ? {
    layoutId: layout.id, image, imageWidth: dimensions.width, imageHeight: dimensions.height,
    points: [points[0], points[1]],
  } : null;
  const canSave = measurement && getReferenceLength(measurement) * measurement.imageWidth >= 4;

  useEffect(() => {
    const currentImage = imageRef.current;
    if (currentImage?.complete && currentImage.naturalWidth > 0) {
      setDimensions({ width: currentImage.naturalWidth, height: currentImage.naturalHeight });
    }
  }, [image]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) setCalibration(parseMapCalibration(JSON.parse(stored)));
    } catch {
      setStatus("Saved measurements could not be read. You can load a calibration JSON backup.");
    }
  }, []);

  function persist(next: MapCalibration) {
    setCalibration(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStatus("Saved locally. Export JSON when you finish to keep a portable backup.");
    } catch {
      setStatus("Browser storage is unavailable. Export JSON before leaving this page.");
    }
  }

  function chooseMap(slug: string) {
    const map = maps.find(item => item.slug === slug)!;
    const existing = calibration.measurements[slug];
    const nextLayoutId = map.layouts.find(item => item.id === existing?.layoutId)?.id ?? map.layouts[0].id;
    setMapSlug(slug);
    setLayoutId(nextLayoutId);
    setPoints(existing?.points ?? []);
    if (slug !== mapSlug || nextLayoutId !== layout.id) setDimensions(null);
    setZoom(100);
    setStatus("");
  }

  function markPoint(event: MouseEvent<HTMLDivElement>) {
    const rect = imageRef.current?.getBoundingClientRect();
    if (!dimensions || !rect?.width || !rect.height) return;
    const point = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return;
    setPoints(current => current.length === 2 ? [point] : [...current, point]);
    setStatus("");
  }

  function saveMeasurement(nextMap = false) {
    if (!measurement || !canSave) return;
    persist({ ...calibration, referenceMapSlug: calibration.referenceMapSlug || mapSlug,
      measurements: { ...calibration.measurements, [mapSlug]: measurement } });
    if (nextMap) {
      const remaining = maps.find(map => map.slug !== mapSlug && !calibration.measurements[map.slug]);
      if (remaining) chooseMap(remaining.slug);
    }
  }

  function exportJson() {
    const text = JSON.stringify({ ...calibration, scaleFactors: getCalibrationFactors(calibration) }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "r6-map-calibration.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function loadJson(file: File) {
    try {
      const imported = parseMapCalibration(JSON.parse(await file.text()));
      for (const [slug, record] of Object.entries(imported.measurements)) {
        const map = maps.find(item => item.slug === slug);
        const floor = map?.layouts.find(item => item.id === record.layoutId);
        if (!floor || record.image !== (floor.floorImage ?? floor.image)) throw new Error("The file contains an unknown map or floor image.");
      }
      persist(imported);
      setPoints([]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load calibration JSON.");
    }
  }

  return (
    <main className={styles.tool}>
      <header className={styles.header}>
        <div><span className={styles.kicker}>One-time setup</span><h1>Map scale calibration</h1></div>
        <a href="/">Back to StratShare</a>
      </header>
      <p className={styles.instructions}>On each map, choose a floor and click both ends of the same in-game distance, such as one hatch edge. Use the same kind of reference on every map. Zoom in for precision; it does not affect the measurement.</p>
      <p className={styles.instructions}>Measurements are saved in this browser. Export the JSON to have the measured scales added permanently to the project. This tool does not change existing strats or the editor zoom yet.</p>
      <div className={styles.controls}>
        <label>Map<select value={mapSlug} onChange={event => chooseMap(event.target.value)}>{maps.map(map => <option key={map.slug} value={map.slug}>{map.name}{calibration.measurements[map.slug] ? " — measured" : ""}</option>)}</select></label>
        <label>Floor<select value={layout.id} onChange={event => { setLayoutId(event.target.value); setPoints([]); setDimensions(null); }}>{selectedMap.layouts.map(floor => <option key={floor.id} value={floor.id}>{floor.label}</option>)}</select></label>
        <label>Reference<input value={calibration.referenceLabel} onChange={event => persist({ ...calibration, referenceLabel: event.target.value })} placeholder="Hatch edge" /></label>
        <label>Zoom: {zoom}%<input aria-label="Calibration zoom" type="range" min={100} max={400} step={25} value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
      </div>
      <div className={styles.workspace}>
        <section>
          <div className={styles.mapFrame}>
            <div className={styles.artwork} onClick={markPoint} style={{ width: `${zoom}%` }}>
              {layout.baseImage ? <img className={styles.base} src={layout.baseImage} alt="" aria-hidden="true" draggable={false} /> : null}
              <img key={image} ref={imageRef} className={styles.floor} src={image} alt={`${selectedMap.name} ${layout.label} reference measurement`} draggable={false} onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => { setDimensions(null); setStatus("The floor image could not be loaded. Choose another floor."); }} />
              <svg className={styles.drawing} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {points.length === 2 ? <line x1={points[0].x * 100} y1={points[0].y * 100} x2={points[1].x * 100} y2={points[1].y * 100} vectorEffect="non-scaling-stroke" /> : null}
              </svg>
              {points.map((point, index) => <span key={index} className={styles.endpoint} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}>{index + 1}</span>)}
            </div>
          </div>
          <div className={styles.actions}>
            <span>{points.length === 0 ? "Click the first endpoint." : points.length === 1 ? "Click the second endpoint." : canSave ? "Reference selected. Save it or click to start again." : "Points are too close. Select a longer reference."}</span>
            <button type="button" onClick={() => setPoints([])} disabled={!points.length}>Clear points</button>
            <button type="button" onClick={() => saveMeasurement()} disabled={!canSave}>Save measurement</button>
            <button className={styles.primary} type="button" onClick={() => saveMeasurement(true)} disabled={!canSave}>Save &amp; next map</button>
          </div>
          <p role="status" className={styles.status}>{status}</p>
        </section>
        <aside className={styles.results}>
          <h2>{completed.length} / {maps.length} maps measured</h2>
          <label>Baseline map<select value={calibration.referenceMapSlug} onChange={event => persist({ ...calibration, referenceMapSlug: event.target.value })}><option value="" disabled>Save your first reference</option>{completed.map(map => <option key={map.slug} value={map.slug}>{map.name}</option>)}</select></label>
          <p>Factors compare the reference length at the same image display width. The baseline is 1×. Only one floor is needed if the map's floor images share a scale.</p>
          <ul>{maps.map(map => <li key={map.slug}><button type="button" onClick={() => chooseMap(map.slug)} aria-current={map.slug === mapSlug ? "true" : undefined}><span>{map.name}</span><span>{factors[map.slug] ? `${factors[map.slug].toFixed(3)}×` : "Unmeasured"}</span></button></li>)}</ul>
          <button className={styles.primary} type="button" onClick={exportJson} disabled={!completed.length}>Export calibration JSON</button>
          <label className={styles.upload}>Load calibration JSON<input type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) void loadJson(file); event.target.value = ""; }} /></label>
          {saved ? <small>Saved floor: {selectedMap.layouts.find(floor => floor.id === saved.layoutId)?.label ?? saved.layoutId}</small> : null}
        </aside>
      </div>
    </main>
  );
}
