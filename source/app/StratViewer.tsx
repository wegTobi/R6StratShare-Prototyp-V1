"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, WheelEvent } from "react";
import type { TacticalMap } from "./map-data";
import { MapLayoutImage } from "./MapLayoutImage";
import { MapPlane } from "./MapPlane";
import { toArtworkPoint } from "./map-coordinates";
import { getCalibratedMapView } from "./map-scale";
import { getAbilityIconScale, getMapModificationIconScale } from "./map-mod-scale";
import { getPlayerGadgetTool, getSlotPlacementLabel, isSlotPlacementVisible } from "./player-gadgets";
import { operators } from "./operator-data";
import { OperatorIcon } from "./OperatorIcon";
import { EquippedGadgets } from "./EquippedGadgets";
import { getMapModIconStyle } from "./map-mod-icon-style";
import type { SlotDetailViewSettings } from "./StratAppShell";
import { parseSurfaceAssignments } from "./map-surfaces";
import type { SurfaceAssignment } from "./map-surfaces";

type ViewPoint = {
  x: number;
  y: number;
};

type ViewMapPan = {
  x: number;
  y: number;
};

type ViewPanDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

const defaultSlotDetailViewSettings: SlotDetailViewSettings = {
  showOtherOperators: false,
  showOtherLines: false,
  showOtherGadgets: false,
};

type ViewDrawingStroke = {
  id?: string;
  layoutId?: string;
  color?: string;
  isEraser?: boolean;
  width?: number;
  points?: ViewPoint[];
};

type ViewMapMod = {
  type?: string;
  typeId?: string;
  layoutId?: string;
  layout?: string;
  rotation?: number;
  size?: number;
  position?: ViewPoint;
};

type ViewSlotGadget = {
  id?: string;
  type?: string;
  rotation?: number;
  layoutId?: string;
  layout?: string;
  iconUrl?: string;
  imageUrls?: string[];
  description?: string;
  size?: number;
  position?: ViewPoint;
};

type ViewSlot = {
  slot?: number;
  role?: string;
  operators?: string[];
  operatorSlugs?: string[];
  layoutId?: string;
  layout?: string;
  position?: ViewPoint | null;
  gadget?: string;
  gadgets?: ViewSlotGadget[];
  equippedGadgets?: string[];
  notes?: string;
};

type ViewPhase = {
  label?: string;
  startsAt?: string;
  viewport?: {
    aspectRatio?: number;
    coordinateSpace?: string;
    width?: number;
    height?: number;
  };
  layout?: string;
  layoutId?: string;
  side?: string;
  playerCount?: number;
  mapModifications?: {
    notes?: string;
    markers?: ViewMapMod[];
    surfaces?: SurfaceAssignment[];
  };
  drawings?: ViewDrawingStroke[];
  slots?: ViewSlot[];
};

type ViewStrat = {
  name?: string;
  map?: string;
  mapSlug?: string;
  layout?: string;
  layoutId?: string;
  layoutImage?: string;
  side?: string;
  playerCount?: number;
  viewport?: {
    aspectRatio?: number;
    coordinateSpace?: string;
    width?: number;
    height?: number;
  };
  mapModifications?: {
    notes?: string;
    markers?: ViewMapMod[];
    surfaces?: SurfaceAssignment[];
  };
  drawings?: ViewDrawingStroke[];
  slots?: ViewSlot[];
  phases?: ViewPhase[];
};

const emptyJson = "";
const mapModificationSprites: Record<string, { row: number; col: number }> = {
  "crouching-rotation": { row: 0, col: 0 },
  "standing-rotation": { row: 0, col: 1 },
  "vault-rotation": { row: 0, col: 2 },
  headholes: { row: 1, col: 0 },
  footholes: { row: 1, col: 1 },
  reinforcement: { row: 1, col: 2 },
  "popped-hatch": { row: 2, col: 0 },
  shield: { row: 2, col: 1 },
  "observation-blocker": { row: 2, col: 2 },
  "barbed-wire": { row: 3, col: 0 },
  "bulletproof-camera": { row: 3, col: 1 },
  "proximity-alarm": { row: 3, col: 2 },
};

const floorOnlyMapModificationTypes = new Set([
  "standing-rotation",
  "crouching-rotation",
  "vault-rotation",
  "headholes",
  "footholes",
]);
const baseDrawingColors = new Set(["#ffffff", "#000000", "#ff3333", "#42f47b", "#1257c8"]);
const viewerSlotColors = ["#22e6c2", "#3aa8ff", "#e7c84f", "#8a7cff", "#f75f9f"];
const mapArtworkAspectRatio = 16 / 9;

function getSpriteStyle(sprite: { row: number; col: number }, rotation = 0, detailed = false): CSSProperties {
  return getMapModIconStyle(sprite,rotation,detailed);
}

const operatorValueAliases: Record<string, string> = {
  capitao: "capito",
  jager: "jger",
  nokk: "nkk",
  skopos: "skops",
  tubarao: "tubaro",
};

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ø/g, "o")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeOperatorValue(value: unknown) {
  const normalized = normalize(value);
  return operatorValueAliases[normalized] ?? normalized;
}

function findOperator(value: string) {
  const normalized = normalizeOperatorValue(value);

  return operators.find(
    (operator) => operator.slug === normalized || normalizeOperatorValue(operator.name) === normalized,
  );
}

function getMarkerTypeClass(type: string | undefined) {
  const normalized = normalize(type).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized === "walk-rotation" ? "vault-rotation" : normalized;
}

function isViewPoint(point: unknown): point is ViewPoint {
  if (!point || typeof point !== "object") {
    return false;
  }

  const candidate = point as ViewPoint;
  return typeof candidate.x === "number" && typeof candidate.y === "number";
}

function isViewStrat(value: unknown): value is ViewStrat {
  return Boolean(value && typeof value === "object");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getCoverZoom(width: number, height: number) {
  if (!width || !height) {
    return 1;
  }

  const canvasAspectRatio = width / height;
  return Number(Math.max(1, canvasAspectRatio / mapArtworkAspectRatio, mapArtworkAspectRatio / canvasAspectRatio).toFixed(2));
}

function normalizeColorValue(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function getViewGadgetImageUrls(gadget: ViewSlotGadget) {
  return Array.from(
    new Set(
      [...(Array.isArray(gadget.imageUrls) ? gadget.imageUrls : []), gadget.iconUrl]
        .map((url) => String(url ?? "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 3);
}

function ViewerStartScreen({ jsonInput, parseError, onChange, onLoad }: { jsonInput: string; parseError: string; onChange: (value: string) => void; onLoad: () => void }) {
  return (
    <div className="viewer-start" data-fd-id="section-viewer-start">
      <header className="viewer-start-head">
        <h1 data-fd-id="text-viewer-start-title">View Strat</h1>
        <p data-fd-id="text-viewer-start-intro">Open a shared strategy to explore its setup, players and phases.</p>
      </header>
      <section className="viewer-start-import" aria-label="Import strategy" data-fd-id="section-viewer-start-import">
        <div className="viewer-start-label">
          <label htmlFor="viewer-start-json" data-fd-id="text-viewer-json-label">Strategy JSON</label>
          <span aria-hidden="true">{ "{ }" }</span>
        </div>
        <textarea id="viewer-start-json" aria-label="Paste strat JSON" aria-describedby="viewer-start-help" aria-invalid={parseError ? true : undefined} data-fd-id="field-viewer-start-json" value={jsonInput} onChange={event => onChange(event.target.value)} placeholder="Paste strat JSON here..." spellCheck={false} />
        <div className="viewer-start-actions">
          <p id="viewer-start-help" data-fd-id="text-viewer-start-help">Copy the JSON from Strat Editor or a shared strat.</p>
          <button type="button" onClick={onLoad} data-fd-id="btn-viewer-start-load">Load Strat <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-5-5 5 5-5 5" /></svg></button>
        </div>
        {parseError ? <p className="viewer-start-error" role="alert">{parseError}</p> : null}
      </section>
      <p className="viewer-start-note" data-fd-id="text-viewer-start-note"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>Strategies open in read-only mode.</p>
    </div>
  );
}

export function StratViewer({
  maps,
  slotDetailViewSettings: initialSlotDetailViewSettings = defaultSlotDetailViewSettings,
}: {
  maps: TacticalMap[];
  slotDetailViewSettings?: SlotDetailViewSettings;
}) {
  const [slotDetailViewSettings, setSlotDetailViewSettings] = useState(initialSlotDetailViewSettings);
  const visibilityMenuRef = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => setSlotDetailViewSettings(initialSlotDetailViewSettings), [initialSlotDetailViewSettings]);
  useEffect(() => {
    function closeVisibility(event: globalThis.PointerEvent | KeyboardEvent) {
      const menu = visibilityMenuRef.current;
      if (menu && ((event instanceof KeyboardEvent && event.key === "Escape") || (event.type === "pointerdown" && !menu.contains(event.target as Node)))) menu.open = false;
    }
    document.addEventListener("pointerdown", closeVisibility);
    document.addEventListener("keydown", closeVisibility);
    return () => { document.removeEventListener("pointerdown", closeVisibility); document.removeEventListener("keydown", closeVisibility); };
  }, []);
  const [jsonInput, setJsonInput] = useState(emptyJson);
  const [loadedStrat, setLoadedStrat] = useState<ViewStrat | null>(null);
  const [parseError, setParseError] = useState("");
  const [activePhaseIndex, setActivePhaseIndex] = useState(0);
  const [selectedGadgetKey, setSelectedGadgetKey] = useState<string | null>(null);
  const [showCalloutsOverlay, setShowCalloutsOverlay] = useState(false);
  const [showMapModsOverlay, setShowMapModsOverlay] = useState(false);
  const [showBombsitesOverlay, setShowBombsitesOverlay] = useState(false);
  const [mapZoom, setMapZoom] = useState(1);
  const [canvasCoverZoom, setCanvasCoverZoom] = useState(1);
  const [canvasAspectRatio, setCanvasAspectRatio] = useState(mapArtworkAspectRatio);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [mapPan, setMapPan] = useState<ViewMapPan>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [viewedLayoutId, setViewedLayoutId] = useState<string | null>(null);
  const [isFloorMenuOpen, setIsFloorMenuOpen] = useState(false);
  const [selectedViewSlotIndex, setSelectedViewSlotIndex] = useState<number | null>(null);
  const panDragState = useRef<ViewPanDragState | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const phases = useMemo(() => {
    if (!loadedStrat) {
      return [];
    }

    if (loadedStrat.phases?.length) {
      return loadedStrat.phases;
    }

    return [
      {
        label: "Phase 1",
        startsAt: "",
        layoutId: loadedStrat.layoutId,
        side: loadedStrat.side,
        playerCount: loadedStrat.playerCount,
        mapModifications: loadedStrat.mapModifications,
        drawings: loadedStrat.drawings,
        slots: loadedStrat.slots,
      },
    ];
  }, [loadedStrat]);

  const activePhase = phases[activePhaseIndex] ?? phases[0];
  const selectedMap = useMemo(() => {
    if (!loadedStrat) {
      return maps[0];
    }

    return (
      maps.find((map) => map.slug === loadedStrat.mapSlug) ??
      maps.find((map) => map.name.toLowerCase() === normalize(loadedStrat.map)) ??
      maps[0]
    );
  }, [loadedStrat, maps]);
  const phaseLayout = useMemo(() => {
    if (!selectedMap) {
      return null;
    }

    return (
      selectedMap.layouts.find((layout) => layout.id === activePhase?.layoutId) ??
      selectedMap.layouts.find((layout) => layout.label.toLowerCase() === normalize(activePhase?.layout)) ??
      selectedMap.layouts.find((layout) => layout.label.toLowerCase() === normalize(loadedStrat?.layout)) ??
      selectedMap.layouts.find((layout) => layout.image === loadedStrat?.layoutImage) ??
      selectedMap.layouts[0]
    );
  }, [activePhase, loadedStrat, selectedMap]);
  const selectedLayout = useMemo(() => {
    if (!selectedMap) {
      return null;
    }

    return selectedMap.layouts.find((layout) => layout.id === viewedLayoutId) ?? phaseLayout;
  }, [phaseLayout, selectedMap, viewedLayoutId]);
  const activeLayoutId = selectedLayout?.id ?? activePhase?.layoutId ?? "";
  const baseMinimumMapZoom = 1;
  const calibratedView = getCalibratedMapView(selectedMap?.slug ?? "", canvasSize.width, canvasSize.height, 1, 1);
  // Start with the whole floor visible; calibrated reference sizing is retained for markers and zoom limits.
  const defaultMapZoom = baseMinimumMapZoom;
  const minimumMapZoom = Math.min(calibratedView.minimumZoom, defaultMapZoom);
  const maximumMapZoom = Math.max(calibratedView.maximumZoom, defaultMapZoom);
  const mapMarkerScale = calibratedView.mapMarkerScale;
  const markerScale = Number((1 / mapZoom).toFixed(4));
  const projectSavedPoint = (point: ViewPoint, layoutId?: string) => toArtworkPoint(point, { ...loadedStrat?.viewport, ...activePhase?.viewport },
    (selectedMap?.layouts.find(layout => layout.id === layoutId) ?? phaseLayout)?.imageTransform);
  const slots = activePhase?.slots ?? loadedStrat?.slots ?? [];
  const selectedViewSlot =
    selectedViewSlotIndex === null ? null : slots[selectedViewSlotIndex] ?? null;
  const selectedSlotColor =
    selectedViewSlotIndex === null ? "" : normalizeColorValue(viewerSlotColors[selectedViewSlotIndex]);
  const selectedViewSlotOperators =
    selectedViewSlot ? (selectedViewSlot.operatorSlugs?.length ? selectedViewSlot.operatorSlugs : selectedViewSlot.operators) ?? [] : [];
  const selectedViewPrimaryOperatorValue = selectedViewSlotOperators[0] ?? "";
  const selectedViewPrimaryOperator = selectedViewPrimaryOperatorValue ? findOperator(selectedViewPrimaryOperatorValue) : null;
  const loadedStratName = loadedStrat?.name?.trim();
  const selectedViewSecondaryOperators = selectedViewSlotOperators.slice(1, 3).map((operatorValue) => ({
    operator: findOperator(operatorValue),
    value: operatorValue,
  }));
  const selectedViewSlotGadgets = selectedViewSlot?.gadgets ?? [];
  const drawings = (activePhase?.drawings ?? loadedStrat?.drawings ?? []).filter((stroke) => {
    const isActiveFloor = !stroke.layoutId || stroke.layoutId === activeLayoutId;

    if (!isActiveFloor) {
      return false;
    }

    if (!selectedViewSlot || slotDetailViewSettings.showOtherLines) {
      return true;
    }

    if (stroke.isEraser) {
      return true;
    }

    const strokeColor = normalizeColorValue(stroke.color);
    return baseDrawingColors.has(strokeColor) || strokeColor === selectedSlotColor;
  });
  const projectedDrawings = drawings.map((stroke) => ({
    ...stroke,
    points: (stroke.points ?? []).map((point) => projectSavedPoint(point, stroke.layoutId)),
  }));
  const mapMods = (activePhase?.mapModifications?.markers ?? loadedStrat?.mapModifications?.markers ?? []).filter(
    (marker) => {
      const typeClass = getMarkerTypeClass(marker.typeId ?? marker.type);
      return marker.layoutId === activeLayoutId || !floorOnlyMapModificationTypes.has(typeClass);
    },
  );
  useEffect(() => {
    setMapZoom(defaultMapZoom);
    setMapPan({ x: 0, y: 0 });
    setIsPanning(false);
    panDragState.current = null;
  }, [activeLayoutId, defaultMapZoom, loadedStrat]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const measuredCanvas = canvas;
    let resizeFrame: number | null = null;
    function updateCoverZoom() {
      const rect = measuredCanvas.getBoundingClientRect();
      setCanvasCoverZoom(getCoverZoom(rect.width, rect.height));
      if (rect.width && rect.height) {
        const width = measuredCanvas.clientWidth;
        const height = measuredCanvas.clientHeight;
        setCanvasSize(current => current.width === width && current.height === height ? current : { width, height });
        setCanvasAspectRatio(width / height);
      }
    }

    updateCoverZoom();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        updateCoverZoom();
      });
    });
    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    };
  }, [activeLayoutId, loadedStrat]);

  useEffect(() => {
    setViewedLayoutId(null);
    setIsFloorMenuOpen(false);
  }, [activePhaseIndex, selectedMap?.slug]);

  function handleCanvasWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const direction = event.deltaY < 0 ? 1 : -1;

    setMapZoom((current) => {
      const nextZoom = clamp(current + direction * 0.15, minimumMapZoom, maximumMapZoom);
      if (nextZoom <= minimumMapZoom) {
        setMapPan({ x: 0, y: 0 });
      }
      return nextZoom;
    });
  }

  function startCanvasPan(event: PointerEvent<HTMLDivElement>) {
    if (mapZoom <= minimumMapZoom || event.target !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    panDragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: mapPan.x,
      originY: mapPan.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCanvasPan(event: PointerEvent<HTMLDivElement>) {
    const drag = panDragState.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const hasMoved = Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3;

    if (!drag.moved && !hasMoved) {
      return;
    }

    if (hasMoved) {
      drag.moved = true;
      setIsPanning(true);
    }

    setMapPan({
      x: drag.originX + deltaX,
      y: drag.originY + deltaY,
    });
  }

  function endCanvasPan(event: PointerEvent<HTMLDivElement>) {
    const drag = panDragState.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    panDragState.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function loadJson() {
    try {
      const parsed: unknown = JSON.parse(jsonInput);

      if (!isViewStrat(parsed)) {
        throw new Error("JSON must contain a strat object.");
      }

      setLoadedStrat(parsed);
      setActivePhaseIndex(0);
      setSelectedGadgetKey(null);
      setSelectedViewSlotIndex(null);
      setViewedLayoutId(null);
      setIsFloorMenuOpen(false);
      setParseError("");
    } catch (error) {
      setLoadedStrat(null);
      setParseError(error instanceof Error ? error.message : "Invalid JSON.");
    }
  }

  useEffect(() => {
    if (selectedViewSlotIndex !== null && selectedViewSlotIndex >= slots.length) {
      setSelectedViewSlotIndex(null);
    }
  }, [selectedViewSlotIndex, slots.length]);

  if (!loadedStrat) {
    return <ViewerStartScreen jsonInput={jsonInput} parseError={parseError} onChange={setJsonInput} onLoad={loadJson} />;
  }

  return (
    <div className="strat-viewer">
      {loadedStrat && selectedMap && selectedLayout ? (
        <>
          <div className={selectedViewSlot ? "viewer-strat-head is-slot-focus" : "viewer-strat-head"}>
            <div className="viewer-heading-row" data-fd-id="section-viewer-heading">
            {(
              <div className="viewer-meta">
                <span className="viewer-eyebrow">View Strat <small>Read only</small></span>
                <h1 data-fd-id="text-viewer-strat-name">{loadedStratName || selectedMap.name}</h1>
                <div className="viewer-strat-context"><em>{selectedMap.name}</em>
                <em>{activePhase?.side ?? loadedStrat.side ?? "Side not set"}</em>
                <em>{slots.length || activePhase?.playerCount || loadedStrat.playerCount || 0} players</em></div>
              </div>
            )}
            <nav className="viewer-player-strip" data-fd-id="section-viewer-slot-navigation" aria-label="Player slots" style={{ "--viewer-slot-count": slots.length + 1 } as CSSProperties}>
              {slots.map((slot, index) => {
                const primaryValue = slot.operatorSlugs?.[0] ?? slot.operators?.[0] ?? "";
                const primaryOperator = findOperator(primaryValue);
                return <button aria-label={`Open Slot ${slot.slot ?? index + 1}: ${slot.role || "No role set"}`} aria-pressed={selectedViewSlotIndex === index} className={selectedViewSlotIndex === index ? "active" : ""} key={`player-tab-${index}`} onClick={() => { setSelectedViewSlotIndex(index); setSelectedGadgetKey(null); }} style={{ "--slot-color": viewerSlotColors[index] ?? viewerSlotColors[0] } as CSSProperties} type="button">
                  <span className="viewer-slot-number-wrap">{primaryOperator ? <span aria-hidden="true" className="viewer-slot-background"><OperatorIcon operator={primaryOperator} size={64} /></span> : null}<span className="viewer-slot-number">{slot.slot ?? index + 1}</span></span>
                  <span className="viewer-slot-tab-copy"><strong>{primaryOperator?.name || primaryValue || `Slot ${slot.slot ?? index + 1}`}</strong><small>{slot.role || "No role set"}</small></span>
                </button>;
              })}
              <button data-fd-id="btn-viewer-team-overview" aria-label="Team" title="Team" aria-pressed={selectedViewSlotIndex === null} className={selectedViewSlotIndex === null ? "viewer-team-tab active" : "viewer-team-tab"} onClick={() => { setSelectedViewSlotIndex(null); setSelectedGadgetKey(null); }} style={{ "--slot-color": "var(--teal)" } as CSSProperties} type="button"><span aria-hidden="true" className="viewer-team-background" /></button>
            </nav>
            </div>
            {phases.length ? (
              <div className="viewer-phase-tabs" aria-label="Strat phases">
                {phases.map((phase, index) => (
                  <button
                    aria-pressed={index === activePhaseIndex}
                    className={index === activePhaseIndex ? "active" : ""}
                    key={`${phase.label ?? "Phase"}-${index}`}
                    onClick={() => {
                      setActivePhaseIndex(index);
                      setSelectedGadgetKey(null);
                      setViewedLayoutId(null);
                      setIsFloorMenuOpen(false);
                    }}
                    type="button"
                  >
                    <small>{String(index + 1).padStart(2, "0")}</small>
                    {phase.label || `Phase ${index + 1}`}
                    {phase.startsAt ? <span>{phase.startsAt}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="viewer-layout-grid">
            <section className="viewer-map-panel">
            <div
              aria-label="Readonly strat layout. Use the mouse wheel to zoom and drag while zoomed to move the layout."
              className={`layout-canvas viewer-canvas${mapZoom > minimumMapZoom ? " is-zoomed" : ""}${isPanning ? " is-panning" : ""}`}
              onPointerCancel={endCanvasPan}
              onPointerDown={startCanvasPan}
              onPointerMove={moveCanvasPan}
              onPointerUp={endCanvasPan}
              onWheel={handleCanvasWheel}
              ref={canvasRef}
            >
              <span
                className="layout-pan-layer"
                style={{ transform: `translate(${mapPan.x}px, ${mapPan.y}px)` }}
              >
                <MapPlane zoom={mapZoom}>
                  <MapLayoutImage
                    layout={selectedLayout}
                    map={selectedMap}
                    showBombsites={showBombsitesOverlay}
                    showCallouts={showCalloutsOverlay}
                    showMapMods={showMapModsOverlay}
                    surfaces={{visible:true,assignments:parseSurfaceAssignments(activePhase?.mapModifications ? activePhase.mapModifications.surfaces : loadedStrat?.mapModifications?.surfaces, selectedMap.layouts.map(layout=>layout.id))}}
                  />
                  <svg
                    aria-hidden="true"
                    className="drawing-layer"
                    focusable="false"
                    preserveAspectRatio="none"
                    viewBox="0 0 100 56.25"
                  >
                    <defs>
                      {projectedDrawings.map((stroke, strokeIndex) =>
                        stroke.isEraser ? null : (
                          <mask id={`viewer-drawing-mask-${stroke.id ?? strokeIndex}`} key={`mask-${stroke.id ?? strokeIndex}`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="56.25">
                            <rect fill="white" height="56.25" width="100" x="0" y="0" />
                            {projectedDrawings.slice(strokeIndex + 1).filter((eraserStroke) => eraserStroke.isEraser).map((eraserStroke, eraserIndex) => (
                              <polyline
                                fill="none"
                                key={`eraser-${strokeIndex}-${eraserIndex}`}
                                points={(eraserStroke.points ?? []).map((point) => `${point.x},${point.y*9/16}`).join(" ")}
                                stroke="black"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={(eraserStroke.width ?? 4) / 8}
                              />
                            ))}
                          </mask>
                        ),
                      )}
                    </defs>
                    {projectedDrawings.map((stroke, index) =>
                      stroke.isEraser ? null : (
                        <polyline
                          fill="none"
                          key={stroke.id ?? index}
                          mask={`url(#viewer-drawing-mask-${stroke.id ?? index})`}
                          points={(stroke.points ?? []).map((point) => `${point.x},${point.y*9/16}`).join(" ")}
                          stroke={stroke.color ?? "#ffffff"}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={(stroke.width ?? 4) / 12}
                        />
                      ),
                    )}
                  </svg>
                  {slots.map((slot, index) => {
                    if (
                      selectedViewSlot &&
                      !slotDetailViewSettings.showOtherOperators &&
                      index !== selectedViewSlotIndex
                    ) {
                      return null;
                    }

                    const slotLayoutId = slot.layoutId ?? selectedMap?.layouts.find(layout => layout.label.toLowerCase() === normalize(slot.layout))?.id ?? phaseLayout?.id;
                    if (slotLayoutId !== activeLayoutId) return null;
                    const position = slot.position ? projectSavedPoint(slot.position, slot.layoutId) : null;
                    const operatorValue = slot.operatorSlugs?.[0] ?? slot.operators?.[0] ?? "";
                    const operator = operatorValue ? findOperator(operatorValue) : null;

                    return isViewPoint(position) ? (
                      <span
                        className={`position-marker marker-${index + 1}${operator ? " has-operator" : ""}`}
                        key={`viewer-slot-${index}`}
                        style={{
                          left: `${position.x}%`,
                          top: `${position.y}%`,
                          transform: `scale(${markerScale})`,
                        }}
                        title={operator ? `Slot ${index + 1}: ${operator.name}` : `Slot ${index + 1}`}
                      >
                        {operator ? (
                          <OperatorIcon alt={`${operator.name} marker`} operator={operator} size={28} detailed />
                        ) : (
                          index + 1
                        )}
                      </span>
                    ) : null;
                  })}
                  {slots.flatMap((slot, slotIndex) => {
                    if (
                      selectedViewSlot &&
                      !slotDetailViewSettings.showOtherGadgets &&
                      slotIndex !== selectedViewSlotIndex
                    ) {
                      return [];
                    }

                    return (slot.gadgets ?? []).map((gadget, gadgetIndex) => {
                      if (!isSlotPlacementVisible(gadget.type, slotIndex, selectedViewSlotIndex, slotDetailViewSettings.showOtherGadgets)) return null;
                      const position = gadget.position ? projectSavedPoint(gadget.position, gadget.layoutId) : null;
                      const isOffFloorGadgetMarker = Boolean(gadget.layoutId && gadget.layoutId !== activeLayoutId);
                      const gadgetKey = `${slotIndex}:${gadget.id ?? gadgetIndex}`;
                      const isSelectedGadget = selectedGadgetKey === gadgetKey;
                      const gadgetOperatorValue = slot.operatorSlugs?.[0] ?? slot.operators?.[0] ?? "";
                      const gadgetOperator = gadgetOperatorValue ? findOperator(gadgetOperatorValue) : null;
                      const playerGadget = getPlayerGadgetTool(gadget.type);
                      const placementLabel = getSlotPlacementLabel(gadget.type, gadgetIndex, gadgetOperator?.abilityName);
                      const gadgetIcon = playerGadget ? undefined : gadgetOperator?.gadgetIcon;

                      return isViewPoint(position) ? (
                        <button
                          aria-label={`Show Slot ${slotIndex + 1} ${placementLabel}`}
                          className={`slot-gadget-marker marker-${slotIndex + 1}${playerGadget ? " has-player-gadget" : ""}${gadgetIcon ? " has-ability-icon" : ""}${isSelectedGadget ? " active" : ""}${isOffFloorGadgetMarker ? " is-off-floor" : ""}`}
                          key={`viewer-slot-gadget-${slotIndex}-${gadget.id ?? gadgetIndex}`}
                          onClick={() => {
                            setSelectedGadgetKey(gadgetKey);
                            setSelectedViewSlotIndex(slotIndex);
                          }}
                          style={{
                            "--slot-marker-color": viewerSlotColors[slotIndex] ?? "#22e6c2",
                            left: `${position.x}%`,
                            top: `${position.y}%`,
                            transform: `scale(${(gadget.size ?? 1) * mapMarkerScale * (playerGadget ? getMapModificationIconScale(playerGadget.type) : getAbilityIconScale(mapZoom))})`,
                          } as CSSProperties}
                          title={`Slot ${slotIndex + 1}: ${placementLabel}`}
                          type="button"
                        >
                          {playerGadget ? <span aria-hidden="true" className="map-mod-sprite mod-layout-icon" style={getSpriteStyle(playerGadget.sprite, gadget.rotation ?? 0, true)} /> : null}
                          {gadgetIcon ? (
                            <img alt="" className="slot-gadget-ability-icon" draggable={false} src={gadgetIcon} />
                          ) : null}
                        </button>
                      ) : null;
                    });
                  })}
                  {mapMods.map((marker, index) => {
                    const position = marker.position ? projectSavedPoint(marker.position, marker.layoutId) : null;
                    const typeClass = getMarkerTypeClass(marker.typeId ?? marker.type);
                    const sprite = mapModificationSprites[typeClass];
                    const isOffFloorMapModification = Boolean(marker.layoutId && marker.layoutId !== activeLayoutId);

                    return isViewPoint(position) ? (
                      <span
                        className={`map-modification-marker mod-${typeClass}${sprite ? " has-icon" : ""}${isOffFloorMapModification ? " is-off-floor" : ""}`}
                        key={`viewer-mod-${index}`}
                        style={{
                          left: `${position.x}%`,
                          top: `${position.y}%`,
                          transform: `scale(${(marker.size ?? 1) * mapMarkerScale * getMapModificationIconScale(typeClass)})`,
                        }}
                        title={typeClass === "standing-rotation" ? "Vault Rotation" : typeClass === "vault-rotation" ? "Walk Rotation" : marker.type ?? marker.typeId ?? `Map mod ${index + 1}`}
                      >
                        {sprite ? (
                          <span
                            aria-hidden="true"
                            className="map-mod-sprite mod-layout-icon"
                            style={getSpriteStyle(sprite, marker.rotation ?? 0, true)}
                          />
                        ) : (
                          index + 1
                        )}
                      </span>
                    ) : null;
                  })}
                </MapPlane>
              </span>
              <div aria-label="Map overlay controls" className="map-overlay-toggles">
                <button
                  aria-label="Toggle map callouts"
                  aria-pressed={showCalloutsOverlay}
                  className={showCalloutsOverlay ? "map-overlay-toggle active" : "map-overlay-toggle"}
                  onClick={() => setShowCalloutsOverlay((current) => !current)}
                  title="Callouts"
                  type="button"
                >
                  <img alt="" height={18} src="/icons/r6-callout-icon.png" width={18} />
                </button>
                <button
                  aria-label="Toggle map modifications overlay"
                  aria-pressed={showMapModsOverlay}
                  className={showMapModsOverlay ? "map-overlay-toggle active" : "map-overlay-toggle"}
                  onClick={() => setShowMapModsOverlay((current) => !current)}
                  title="Map Mods"
                  type="button"
                >
                  <img alt="" height={18} src="/icons/r6-modifications-icon.png" width={18} />
                </button>
                <button
                  aria-label="Toggle bomb site icons"
                  aria-pressed={showBombsitesOverlay}
                  className={showBombsitesOverlay ? "map-overlay-toggle active" : "map-overlay-toggle"}
                  onClick={() => setShowBombsitesOverlay((current) => !current)}
                  title="Bomb Sites"
                  type="button"
                >
                  <img alt="" height={18} src="/icons/r6-locations-icon.png" width={18} />
                </button>
              </div>
              <div className="viewer-floor-picker">
                <button
                  aria-expanded={isFloorMenuOpen}
                  aria-haspopup="listbox"
                  className="viewer-floor-trigger"
                  onClick={() => setIsFloorMenuOpen((current) => !current)}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  {selectedLayout.label}
                </button>
                {isFloorMenuOpen ? (
                  <div aria-label="View floor options" className="viewer-floor-menu" role="listbox">
                    {selectedMap.layouts.map((layout) => (
                      <button
                        aria-selected={layout.id === activeLayoutId}
                        className={layout.id === activeLayoutId ? "selected" : ""}
                        key={layout.id}
                        onClick={() => {
                          setViewedLayoutId(layout.id);
                          setSelectedGadgetKey(null);
                          setIsFloorMenuOpen(false);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        role="option"
                        type="button"
                      >
                        {layout.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

          </section>

          <aside className={selectedViewSlot ? "viewer-details is-slot-expanded" : "viewer-details"}>
            <div className="viewer-briefing-head">
              <strong>{selectedViewSlot ? "Player briefing" : "Team lineup"}</strong>
              {selectedViewSlot ? <>
                <details className="viewer-visibility-menu" ref={visibilityMenuRef}>
                  <summary aria-label="Map visibility for all player briefings"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>Visibility</summary>
                  <div className="viewer-visibility-options"><strong>Map visibility</strong><p>Applies to all player briefings.</p>
                    {([["showOtherOperators", "Other operators"], ["showOtherLines", "Other lines"], ["showOtherGadgets", "Other gadgets"]] as const).map(([key, label]) => <label key={key}><input checked={slotDetailViewSettings[key]} onChange={event => setSlotDetailViewSettings(current => ({ ...current, [key]: event.target.checked }))} type="checkbox" />{label}</label>)}
                  </div>
                </details>
                <button aria-label="Close slot detail view" className="viewer-briefing-back" onClick={() => { setSelectedViewSlotIndex(null); setSelectedGadgetKey(null); }} title="Back to team" type="button">↩</button>
              </> : <small>{slots.length} slots</small>}
            </div>
            {selectedViewSlot ? (
              <article className="viewer-slot-expanded-card">
                <header>
                  <div>
                    <span>Slot {selectedViewSlot.slot ?? selectedViewSlotIndex! + 1}</span>
                    <strong>{selectedViewSlot.role || "No role set"}</strong>
                  </div>
                </header>
                <div className="viewer-slot-expanded-operators">
                  {selectedViewPrimaryOperator || selectedViewPrimaryOperatorValue ? (
                    <div className="viewer-slot-expanded-operator-row">
                      <span className="viewer-slot-expanded-operator primary">
                        {selectedViewPrimaryOperator ? (
                          <>
                            <OperatorIcon operator={selectedViewPrimaryOperator} size={40} />
                            <span>{selectedViewPrimaryOperator.name}</span>
                          </>
                        ) : (
                          selectedViewPrimaryOperatorValue
                        )}
                      </span>
                      {selectedViewSecondaryOperators.map(({ operator, value }, operatorIndex) => (
                        <span className="viewer-slot-expanded-operator secondary" key={`${value}-${operatorIndex}`}>
                          {operator ? (
                            <>
                              <OperatorIcon operator={operator} size={22} />
                              <span>{operator.name}</span>
                            </>
                          ) : (
                            value
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <em>No operators selected</em>
                  )}
                </div>
                {selectedViewSlot.gadget ? (
                  <section>
                    <span>Plan</span>
                    <p>{selectedViewSlot.gadget}</p>
                  </section>
                ) : null}
                <EquippedGadgets value={selectedViewSlot.equippedGadgets} />
                {selectedViewSlotGadgets.length ? (
                  <section className="viewer-slot-expanded-gadgets">
                    <span>Abilities &amp; Gadgets</span>
                    <div className="viewer-expanded-gadget-list">
                      {selectedViewSlotGadgets.map((gadget, gadgetIndex) => {
                        const imageUrls = getViewGadgetImageUrls(gadget);
                        const gadgetKey = `${selectedViewSlotIndex}:${gadget.id ?? gadgetIndex}`;
                        const isSelectedGadget = selectedGadgetKey === gadgetKey;
                        const hasGadgetDescription = Boolean(gadget.description);

                        return (
                          <article
                            aria-pressed={isSelectedGadget}
                            className={`viewer-expanded-gadget-card${isSelectedGadget ? " active" : ""}${hasGadgetDescription ? "" : " is-compact"}`}
                            key={`expanded-gadget-${gadget.id ?? gadgetIndex}`}
                            onClick={() => { setSelectedGadgetKey(gadgetKey); if (gadget.layoutId && selectedMap.layouts.some(layout => layout.id === gadget.layoutId)) setViewedLayoutId(gadget.layoutId); }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedGadgetKey(gadgetKey);
                                if (gadget.layoutId && selectedMap.layouts.some(layout => layout.id === gadget.layoutId)) setViewedLayoutId(gadget.layoutId);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <strong>{getPlayerGadgetTool(gadget.type) ? <span aria-hidden="true" className="map-mod-sprite mod-tool-icon" style={getSpriteStyle(getPlayerGadgetTool(gadget.type)!.sprite, gadget.rotation ?? 0)} /> : null}{getSlotPlacementLabel(gadget.type, gadgetIndex, selectedViewPrimaryOperator?.abilityName)}</strong>
                            <small className="viewer-placement-floor">{selectedMap.layouts.find(layout => layout.id === gadget.layoutId)?.label || gadget.layout || "Floor not set"}{gadget.layoutId && gadget.layoutId !== activeLayoutId ? " · Other floor" : ""}</small>
                            {hasGadgetDescription ? (
                              <p>{gadget.description}</p>
                            ) : null}
                            {imageUrls.length ? (
                              <details className="viewer-placement-reference">
                              <summary>Reference images · {imageUrls.length}</summary>
                              <div className="viewer-gadget-images viewer-expanded-gadget-images">
                                {imageUrls.map((url, imageIndex) => (
                                  <img
                                    alt={`Slot ${selectedViewSlot.slot ?? selectedViewSlotIndex! + 1} ${getSlotPlacementLabel(gadget.type, gadgetIndex, selectedViewPrimaryOperator?.abilityName)} reference ${imageIndex + 1}`}
                                    key={`${url}-${imageIndex}`}
                                    loading="lazy"
                                    src={url}
                                  />
                                ))}
                              </div>
                              </details>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                {selectedViewSlot.notes ? (
                  <section>
                    <span>Notes</span>
                    <p>{selectedViewSlot.notes}</p>
                  </section>
                ) : null}
              </article>
            ) : (
              <>
            <div className="viewer-summary">
              <span>Strat</span>
              <strong>{loadedStratName || loadedStrat.map || selectedMap.name}</strong>
              <p>{slots.length || activePhase?.playerCount || loadedStrat.playerCount || 0} player slots loaded</p>
            </div>
            <div className="viewer-slot-list">
              {slots.map((slot, index) => {
                const slotOperators = (slot.operatorSlugs?.length ? slot.operatorSlugs : slot.operators) ?? [];
                const lineupGadgets = (slot.gadgets ?? []).filter(gadget => getPlayerGadgetTool(gadget.type));

                return (
                  <article className="viewer-slot-card" data-fd-id={`card-team-slot-${index + 1}`} style={{ "--slot-color": viewerSlotColors[index] ?? viewerSlotColors[0] } as CSSProperties} key={`viewer-card-${index}`}>
                    <header>
                      <div className="viewer-lineup-identity">
                      <span className="viewer-slot-title">
                        <span className="viewer-slot-name">Slot {slot.slot ?? index + 1}</span>
                        <span className="viewer-slot-role">{slot.role || "No role set"}</span>
                      </span>
                    <div className="viewer-operator-row">
                      {slotOperators.length ? (
                        slotOperators.map((operatorValue, operatorIndex) => {
                          const operator = findOperator(operatorValue);
                          return operator ? (
                            <span className={operatorIndex === 0 ? "viewer-operator-pill is-primary" : "viewer-operator-pill"} key={operator.slug}>
                              <OperatorIcon operator={operator} size={24} />
                              {operator.name}
                            </span>
                          ) : (
                            <span className={operatorIndex === 0 ? "viewer-operator-pill is-primary" : "viewer-operator-pill"} key={operatorValue}>{operatorValue}</span>
                          );
                        })
                      ) : (
                        <em>No operators selected</em>
                      )}
                    </div>
                      </div>
                      <button
                        className="viewer-slot-action"
                        onClick={() => {
                          setSelectedViewSlotIndex(index);
                          setSelectedGadgetKey(null);
                        }}
                        type="button"
                      >
                        View
                      </button>
                    </header>
                    {slot.notes ? <p className="viewer-lineup-notes"><b>Notes:</b> {slot.notes}</p> : null}
                    {slot.gadget ? <p><b>Plan:</b> {slot.gadget}</p> : null}
                    <EquippedGadgets value={slot.equippedGadgets} />
                    {lineupGadgets.length ? (
                      <section className="viewer-lineup-gadgets" aria-label={`Slot ${slot.slot ?? index + 1} gadgets`}>
                        <strong>Gadgets</strong>
                        <ul>
                          {lineupGadgets.map((gadget, gadgetIndex) => {
                            const tool = getPlayerGadgetTool(gadget.type);
                            return <li key={gadget.id ?? gadgetIndex}>
                              {gadget.iconUrl ? <img alt="" aria-hidden="true" src={gadget.iconUrl} /> : tool ? <span aria-hidden="true" className="map-mod-sprite mod-tool-icon" style={getSpriteStyle(tool.sprite, 0)} /> : null}
                              <span>{getSlotPlacementLabel(gadget.type, gadgetIndex)}</span>
                            </li>;
                          })}
                        </ul>
                      </section>
                    ) : null}
                  </article>
                );
              })}
            </div>
              </>
            )}
          </aside>
          </div>
        </>
      ) : (
        <div className="viewer-empty">
          <span>Paste JSON and load it to view a strat without editing it.</span>
        </div>
      )}
    </div>
  );
}
