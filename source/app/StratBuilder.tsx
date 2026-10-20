"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import type { TacticalMap } from "./map-data";
import { operators } from "./operator-data";
import type { OperatorSide } from "./operator-data";
import { MapLayoutImage } from "./MapLayoutImage";
import { getCalibratedMapView } from "./map-scale";
import { getMapProjectionScale, projectMapPoint, mapCoordinateAspectRatio } from "./map-coordinates";
import { getAbilityIconScale, getMapModificationIconScale } from "./map-mod-scale";
import { playerGadgetTools, getPlayerGadgetTool, getSlotPlacementLabel, reorderSlotEquipment } from "./player-gadgets";
import type { PlayerGadgetType } from "./player-gadgets";
import { OperatorIcon } from "./OperatorIcon";
import { getMapModIconStyle } from "./map-mod-icon-style";
import { countReinforcedSurfaces, getDisplaySurfaceLayout, findSurfaceAssignment, getSurfaceAssignmentTarget, parseSurfaceAssignments, setSurfaceAssignment } from "./map-surfaces";
import type { MapSurface, SurfaceAssignment } from "./map-surfaces";
import { MapSurfaceMenu } from "./MapSurfaceMenu";

type SlotMarker = {
  x: number;
  y: number;
  layoutId?: string;
};

type DrawingPoint = {
  x: number;
  y: number;
};

type DrawingStroke = {
  id: string;
  layoutId: string;
  color: string;
  isEraser?: boolean;
  width: number;
  points: DrawingPoint[];
};

type ModificationType =
  | "standing-rotation"
  | "crouching-rotation"
  | "vault-rotation"
  | "headholes"
  | "footholes"
  | "popped-hatch"
  | "reinforcement"
  | "shield"
  | "barbed-wire"
  | "proximity-alarm"
  | "bulletproof-camera"
  | "observation-blocker";

type MapModificationMarker = {
  id: string;
  type: ModificationType;
  layoutId: string;
  rotation: number;
  size: number;
  x: number;
  y: number;
};

type SlotGadgetMarker = {
  id: string;
  type?: PlayerGadgetType;
  rotation?: number;
  layoutId: string;
  imageUrls: string[];
  description: string;
  size: number;
  x: number;
  y: number;
};

type SlotState = {
  role: string;
  operators: string[];
  gadget: string;
  gadgets: SlotGadgetMarker[];
  notes: string;
  marker?: SlotMarker;
};

type StratPhaseSnapshot = {
  layoutId: string;
  playerCount: number;
  side: OperatorSide;
  activeSlot: number;
  slots: SlotState[];
  mapModifications: string;
  mapModificationMarkers: MapModificationMarker[];
  drawingStrokes: DrawingStroke[];
  surfaceAssignments: SurfaceAssignment[];
};

type StratPhase = {
  id: string;
  label: string;
  startsAt: string;
  snapshot: StratPhaseSnapshot;
};

type StratJsonPoint = {
  x: number;
  y: number;
};

type StratJsonSlot = {
  slot?: number;
  role?: string;
  operators?: string[];
  operatorSlugs?: string[];
  layoutId?: string;
  layout?: string;
  position?: StratJsonPoint | null;
  gadget?: string;
  gadgets?: Array<{
    id?: string;
    type?: string;
    rotation?: number;
    layoutId?: string;
    layout?: string;
    iconUrl?: string;
    imageUrls?: string[];
    description?: string;
    size?: number;
    position?: StratJsonPoint;
  }>;
  notes?: string;
};

type StratJsonDrawing = {
  id?: string;
  layoutId?: string;
  layout?: string;
  color?: string;
  isEraser?: boolean;
  width?: number;
  points?: StratJsonPoint[];
};

type StratJsonMapModification = {
  type?: string;
  typeId?: string;
  layoutId?: string;
  layout?: string;
  rotation?: number;
  size?: number;
  position?: StratJsonPoint;
};

type StratJsonPhase = {
  label?: string;
  startsAt?: string;
  viewport?: {
    aspectRatio?: number;
  };
  layoutId?: string;
  layout?: string;
  side?: OperatorSide;
  playerCount?: number;
  mapModifications?: {
    notes?: string;
    markers?: StratJsonMapModification[];
    surfaces?: SurfaceAssignment[];
  };
  drawings?: StratJsonDrawing[];
  slots?: StratJsonSlot[];
};

type StratJson = {
  name?: string;
  map?: string;
  mapSlug?: string;
  layout?: string;
  layoutId?: string;
  layoutImage?: string;
  side?: OperatorSide;
  playerCount?: number;
  viewport?: {
    aspectRatio?: number;
  };
  mapModifications?: {
    notes?: string;
    markers?: StratJsonMapModification[];
    surfaces?: SurfaceAssignment[];
  };
  drawings?: StratJsonDrawing[];
  slots?: StratJsonSlot[];
  phases?: StratJsonPhase[];
};

type MapPan = {
  x: number;
  y: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

type MapModificationDragState = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

type SlotMarkerDragState = {
  index: number;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

type SlotGadgetDragState = {
  slotIndex: number;
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

type DrawingDragState = {
  id: string;
  pointerId: number;
};

type SelectOption = {
  label: string;
  value: string;
};

type AutoGrowTextareaProps = {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
};

type ModificationTool = {
  label: string;
  type: ModificationType;
  sprite: {
    row: number;
    col: number;
  };
};

const floorOnlyModificationTypes = new Set<ModificationType>([
  "standing-rotation",
  "crouching-rotation",
  "vault-rotation",
  "headholes",
  "footholes",
]);

const modificationTools: ModificationTool[] = [
  { label: "Vault Rotation", type: "standing-rotation", sprite: { row: 0, col: 1 } },
  { label: "Crouching rotation", type: "crouching-rotation", sprite: { row: 0, col: 0 } },
  { label: "Walk Rotation", type: "vault-rotation", sprite: { row: 0, col: 2 } },
  { label: "Headholes", type: "headholes", sprite: { row: 1, col: 0 } },
  { label: "Footholes", type: "footholes", sprite: { row: 1, col: 1 } },
  { label: "Popped hatch", type: "popped-hatch", sprite: { row: 2, col: 0 } },
  { label: "Reinforcement", type: "reinforcement", sprite: { row: 1, col: 2 } },
];

const allModificationTools: ModificationTool[] = [...modificationTools, ...playerGadgetTools];

const modificationToolGrid: Array<ModificationTool | null> = [
  modificationTools[0],
  modificationTools[1],
  modificationTools[2],
  modificationTools[5],
  modificationTools[3],
  modificationTools[4],
  modificationTools[6],
  null,
];

const defaultMapModSize = 1;
const minMapModSize = 0.6;
const maxMapModSize = 1.8;
const mapModSizeStep = 0.1;
const maxSlotGadgets = 7;
const defaultDrawingColor = "#ffffff";

const mapPreviewFrames: Record<string, { column: number; row: number }> = {
  bank: { column: 0, row: 0 },
  border: { column: 2, row: 0 },
  "calypso-casino": { column: 3, row: 0 },
  chalet: { column: 0, row: 1 },
  clubhouse: { column: 1, row: 1 },
  coastline: { column: 2, row: 1 },
  consulate: { column: 3, row: 1 },
  emeraldplains: { column: 1, row: 2 },
  favela: { column: 2, row: 2 },
  fortress: { column: 3, row: 2 },
  hereford: { column: 0, row: 3 },
  house: { column: 1, row: 3 },
  kafe: { column: 2, row: 3 },
  kanal: { column: 3, row: 3 },
  lair: { column: 0, row: 4 },
  nighthavenlabs: { column: 1, row: 4 },
  oregon: { column: 2, row: 4 },
  outback: { column: 3, row: 4 },
  plane: { column: 0, row: 5 },
  skyscraper: { column: 1, row: 5 },
  stadiuma: { column: 2, row: 5 },
  stadiumb: { column: 3, row: 5 },
  themepark: { column: 0, row: 6 },
  tower: { column: 1, row: 6 },
  villa: { column: 2, row: 6 },
  yacht: { column: 3, row: 6 },
};

function getMapPreviewStyle(map: TacticalMap | undefined): CSSProperties {
  const frame = map ? mapPreviewFrames[map.slug] : undefined;

  if (frame) {
    return {
      backgroundImage: 'url("/map-previews/map-preview-sheet.webp")',
      backgroundPosition: `${(frame.column / 3) * 100}% ${(frame.row / 6) * 100}%`,
      backgroundSize: "400% 700%",
    };
  }

  const fallbackImage = map?.layouts.find((layout) => layout.label.toLowerCase() === "1st floor")?.image ?? map?.layouts[0]?.image;
  return fallbackImage ? { backgroundImage: `url("${fallbackImage}")` } : {};
}
const defaultDrawingWidth = 4;
const maxPhaseCount = 10;
const mapArtworkAspectRatio = 16 / 9;
const drawingColors = [
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#000000" },
  { label: "Red", value: "#ff3333" },
  { label: "Light green", value: "#42f47b" },
  { label: "Dark blue", value: "#1257c8" },
];
const slotDrawingColors = [
  { label: "Slot 1", value: "#22e6c2" },
  { label: "Slot 2", value: "#3aa8ff" },
  { label: "Slot 3", value: "#e7c84f" },
  { label: "Slot 4", value: "#8a7cff" },
  { label: "Slot 5", value: "#f75f9f" },
];

function getModificationLabel(type: ModificationType) {
  return allModificationTools.find((tool) => tool.type === type)?.label ?? type;
}

function getModificationSprite(type: ModificationType) {
  return allModificationTools.find((tool) => tool.type === type)?.sprite;
}

function getSpriteStyle(sprite: ModificationTool["sprite"], rotation = 0, detailed = false): CSSProperties {
  return getMapModIconStyle(sprite,rotation,detailed);
}

function MapModificationIcon({
  className,
  rotation,
  sprite,
}: {
  className: string;
  rotation?: number;
  sprite: ModificationTool["sprite"];
}) {
  return (
    <span
      aria-hidden="true"
      className={`map-mod-sprite ${className}`}
      style={getSpriteStyle(sprite, rotation, className === "mod-layout-icon")}
    />
  );
}

function AutoGrowTextarea({ placeholder, value, onChange }: AutoGrowTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "42px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
  );
}

function createSlots(count: number): SlotState[] {
  return Array.from({ length: count }, () => ({
    role: "",
    operators: [],
    gadget: "",
    gadgets: [],
    notes: "",
  }));
}

function createEmptyPhaseSnapshot(layoutId: string): StratPhaseSnapshot {
  return {
    layoutId,
    playerCount: 3,
    side: "Defense",
    activeSlot: 0,
    slots: createSlots(3),
    mapModifications: "",
    mapModificationMarkers: [],
    drawingStrokes: [],
    surfaceAssignments: [],
  };
}

function getDefaultLayoutId(map: TacticalMap | undefined) {
  return (
    map?.layouts.find((layout) => layout.label.toLowerCase() === "1st floor") ??
    map?.layouts[0]
  )?.id ?? "";
}

function getOperator(slug: string) {
  return operators.find((operator) => operator.slug === slug);
}

function getOperatorSlug(value: string) {
  const normalized = value.trim().toLowerCase();

  return operators.find(
    (operator) => operator.slug === normalized || operator.name.toLowerCase() === normalized,
  )?.slug;
}

function isPoint(value: unknown): value is StratJsonPoint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const point = value as StratJsonPoint;
  return typeof point.x === "number" && typeof point.y === "number";
}

function isStratJson(value: unknown): value is StratJson {
  return Boolean(value && typeof value === "object");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getCoverZoom(width: number, height: number) {
  if (!width || !height) {
    return 1;
  }

  const canvasAspectRatio = width / height;
  return Number(Math.max(1, canvasAspectRatio / mapArtworkAspectRatio, mapArtworkAspectRatio / canvasAspectRatio).toFixed(2));
}

function slotsMatchDefault(slots: SlotState[], count: number) {
  const defaults = createSlots(count);

  return (
    slots.length === defaults.length &&
    slots.every((slot, index) => {
      const defaultSlot = defaults[index];
      return (
        slot.role === defaultSlot.role &&
        slot.gadget === defaultSlot.gadget &&
        slot.gadgets.length === defaultSlot.gadgets.length &&
        slot.notes === defaultSlot.notes &&
        !slot.marker &&
        slot.operators.length === defaultSlot.operators.length &&
        slot.operators.every((operatorSlug, operatorIndex) => operatorSlug === defaultSlot.operators[operatorIndex])
      );
    })
  );
}

function slotHasChanges(slot: SlotState) {
  return (
    slot.role.trim().length > 0 ||
    slot.gadget.trim().length > 0 ||
    slot.gadgets.length > 0 ||
    slot.notes.trim().length > 0 ||
    slot.operators.length > 0 ||
    Boolean(slot.marker)
  );
}

function SetupSideIcon({ side, watermark = false }: { side: OperatorSide; watermark?: boolean }) {
  return <svg aria-hidden="true" className={watermark ? "entry-side-watermark" : undefined} width="18" height="18" viewBox="0 0 30 30"><path fill="currentColor" d={side === "Defense"
    ? "M19.27,9.74l-4.25,2.17L10.73,9.7L8.15,28h13.7L19.27,9.74z M21.23,7.01V2h-2.88v1.73h-1.96V2h-2.78v1.73h-1.96V2H8.77v4.96l6.25,3.51L21.23,7.01z"
    : "M8.32,19.16l-5.54,5.54H2V28h3.31v-0.79l5.54-5.54H8.32V19.16z M25.2,2L10.29,17.18L8.5,15.4l-0.94,0.94l1.87,1.87v2.36h2.36l1.87,1.87l0.94-0.94l-1.78-1.78L28,4.8V2H25.2z M21.68,19.16v2.52h-2.52l5.54,5.54V28H28v-3.31h-0.78L21.68,19.16z M14.6,11.98L4.8,2H2v2.8l9.98,9.8L14.6,11.98z M20.57,18.21l1.87-1.87L21.5,15.4l-1.78,1.78l-1.67-1.71l-2.56,2.56l1.7,1.67L15.4,21.5l0.94,0.94l1.87-1.87h2.36V18.21z"} /></svg>;
}

export function StratBuilder({ maps, advancedMode = false }: { maps: TacticalMap[]; advancedMode?: boolean }) {
  const [mapSlug, setMapSlug] = useState(maps[0]?.slug ?? "");
  const [setupMapSlug, setSetupMapSlug] = useState(maps[0]?.slug ?? "");
  const [setupSide, setSetupSide] = useState<OperatorSide>("Defense");
  const [hasOpenedSetupSelection, setHasOpenedSetupSelection] = useState(false);
  const [isEditorSetupComplete, setIsEditorSetupComplete] = useState(false);
  const selectedMap = useMemo(
    () => maps.find((map) => map.slug === mapSlug) ?? maps[0],
    [mapSlug, maps],
  );
  const setupMap = useMemo(
    () => maps.find((map) => map.slug === setupMapSlug) ?? maps[0],
    [maps, setupMapSlug],
  );
  const [layoutId, setLayoutId] = useState(() => getDefaultLayoutId(selectedMap));
  const selectedLayout =
    selectedMap?.layouts.find((layout) => layout.id === layoutId) ??
    selectedMap?.layouts.find((layout) => layout.id === getDefaultLayoutId(selectedMap)) ??
    selectedMap?.layouts[0];
  const initialLayoutId = getDefaultLayoutId(selectedMap);
  const [phases, setPhases] = useState<StratPhase[]>(() => [
    {
      id: "phase-1",
      label: "Phase 1",
      startsAt: "",
      snapshot: createEmptyPhaseSnapshot(initialLayoutId),
    },
  ]);
  const [activePhaseId, setActivePhaseId] = useState("phase-1");
  const [playerCount, setPlayerCount] = useState(3);
  const [side, setSide] = useState<OperatorSide>("Defense");
  const [activeSlot, setActiveSlot] = useState(0);
  const [slots, setSlots] = useState<SlotState[]>(() => createSlots(3));
  const [mapModifications, setMapModifications] = useState("");
  const [mapModificationMarkers, setMapModificationMarkers] = useState<MapModificationMarker[]>([]);
  const [surfaceAssignments, setSurfaceAssignments] = useState<SurfaceAssignment[]>([]);
  const [selectedSurface, setSelectedSurface] = useState<MapSurface | null>(null);
  const [reviewSurfaces, setReviewSurfaces] = useState(false);
  const [activeMapModificationMarkerId, setActiveMapModificationMarkerId] = useState<string | null>(null);
  const [drawingStrokes, setDrawingStrokes] = useState<DrawingStroke[]>([]);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawingColor, setDrawingColor] = useState(defaultDrawingColor);
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [drawingWidth, setDrawingWidth] = useState(defaultDrawingWidth);
  const [activeModificationType, setActiveModificationType] =
    useState<ModificationType>("standing-rotation");
  const [editorPanel, setEditorPanel] = useState<"slots" | "map-modifications">("slots");
  const [mapZoom, setMapZoom] = useState(1);
  const [canvasCoverZoom, setCanvasCoverZoom] = useState(1);
  const [canvasAspectRatio, setCanvasAspectRatio] = useState(mapArtworkAspectRatio);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [mapPan, setMapPan] = useState<MapPan>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [pendingMapSlug, setPendingMapSlug] = useState<string | null>(null);
  const [pendingSide, setPendingSide] = useState<OperatorSide | null>(null);
  const [pendingGadgetSlotIndex, setPendingGadgetSlotIndex] = useState<number | null>(null);
  const [pendingPlayerGadgetType, setPendingPlayerGadgetType] = useState<PlayerGadgetType | undefined>();
  const [showPlayerGadgetMenu, setShowPlayerGadgetMenu] = useState(false);
  const [activeSlotGadgetMarkerId, setActiveSlotGadgetMarkerId] = useState<string | null>(null);
  const [expandedSlotGadgetMarkerId, setExpandedSlotGadgetMarkerId] = useState<string | null>(null);
  const slotEquipmentDrag = useRef<{ id: string; slotIndex: number; phaseId: string; targetId?: string } | null>(null);
  const [slotGadgetDropTargetId, setSlotGadgetDropTargetId] = useState<string | null>(null);
  const [equipmentOrderStatus, setEquipmentOrderStatus] = useState("");
  const [jsonImport, setJsonImport] = useState("");
  const [jsonStatus, setJsonStatus] = useState("");
  const [copyToastStatus, setCopyToastStatus] = useState("");
  const [isJsonLoadOpen, setIsJsonLoadOpen] = useState(false);
  const [stratName, setStratName] = useState("");
  const [stratNameInput, setStratNameInput] = useState("");
  const [pendingJsonAction, setPendingJsonAction] = useState<"save" | "export" | null>(null);
  const [showCalloutsOverlay, setShowCalloutsOverlay] = useState(false);
  const [showMapModsOverlay, setShowMapModsOverlay] = useState(false);
  const [showBombsitesOverlay, setShowBombsitesOverlay] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<DragState | null>(null);
  const mapModificationDragState = useRef<MapModificationDragState | null>(null);
  const mapModificationListItems = useRef<Record<string, HTMLDivElement | null>>({});
  const slotMarkerDragState = useRef<SlotMarkerDragState | null>(null);
  const slotGadgetDragState = useRef<SlotGadgetDragState | null>(null);
  const drawingDragState = useRef<DrawingDragState | null>(null);
  const suppressNextClick = useRef(false);
  useEffect(() => {
    if (!isDrawingMode) return;

    function exitDrawingForControl(event: globalThis.Event) {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(".drawing-panel, .drawing-toggle")) return;
      const control = target.closest('button, a[href], input, select, textarea, label, summary, [role="button"], [role="tab"], [role="option"], [tabindex]:not([tabindex="-1"])');
      if (!control || control === canvasRef.current) return;
      drawingDragState.current = null;
      setIsDrawingMode(false);
    }

    document.addEventListener("pointerdown", exitDrawingForControl, true);
    document.addEventListener("click", exitDrawingForControl, true);
    return () => {
      document.removeEventListener("pointerdown", exitDrawingForControl, true);
      document.removeEventListener("click", exitDrawingForControl, true);
    };
  }, [isDrawingMode]);
  const sideOperators = operators.filter((operator) => operator.side === side);
  const activeAbilityName = getOperator(slots[activeSlot]?.operators[0] ?? "")?.abilityName;
  const pendingMap = pendingMapSlug
    ? maps.find((map) => map.slug === pendingMapSlug)
    : null;
  const baseMinimumMapZoom = selectedLayout?.imageTransform?.scale
    ? Number((1 / selectedLayout.imageTransform.scale).toFixed(2))
    : 1;
  const calibratedView = getCalibratedMapView(mapSlug, canvasSize.width, canvasSize.height, selectedLayout?.imageTransform?.scale ?? 1, Math.max(baseMinimumMapZoom, canvasCoverZoom));
  const defaultMapZoom = calibratedView.defaultZoom;
  const minimumMapZoom = calibratedView.minimumZoom;
  const maximumMapZoom = calibratedView.maximumZoom;
  const mapMarkerScale = calibratedView.mapMarkerScale;
  const markerScale = Number((1 / mapZoom).toFixed(4));
  const markerProjectionScale = getMapProjectionScale(mapCoordinateAspectRatio, canvasAspectRatio);
  const projectEditorPoint = (point: DrawingPoint) => projectMapPoint(point, markerProjectionScale);
  const isDefenseSide = side === "Defense";
  const activeLayoutId = selectedLayout?.id ?? layoutId;
  useEffect(() => { setShowPlayerGadgetMenu(false); }, [activeSlot, activePhaseId, mapSlug, side, activeLayoutId]);
  const surfaceLayout = getDisplaySurfaceLayout(activeLayoutId,selectedMap.layouts);
  const reinforcementCount = countReinforcedSurfaces(surfaceAssignments);
  const selectedSurfaceAssignment = selectedSurface ? findSurfaceAssignment(surfaceAssignments,activeLayoutId,selectedSurface) : undefined;
  useEffect(() => { setSelectedSurface(null); }, [activeLayoutId, activePhaseId, mapSlug, side, isDrawingMode, pendingGadgetSlotIndex]);
  const visibleMapModificationMarkers = mapModificationMarkers.filter(
    (marker) => marker.layoutId === activeLayoutId || !floorOnlyModificationTypes.has(marker.type),
  );
  const visibleDrawingStrokes = drawingStrokes.filter((stroke) => stroke.layoutId === activeLayoutId);
  const visibleSlotDrawingColors = slotDrawingColors.slice(0, playerCount);
  const activePhase = phases.find((phase) => phase.id === activePhaseId) ?? phases[0];
  const activePhaseTriggerLabel = activePhase?.label.replace(/^Phase\s+/i, "") ?? "1";
  const phaseOptions = phases.map((phase) => ({ label: phase.label, startsAt: phase.startsAt, value: phase.id }));

  useEffect(() => {
    if (editorPanel !== "map-modifications" || !activeMapModificationMarkerId) {
      return;
    }

    mapModificationListItems.current[activeMapModificationMarkerId]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeMapModificationMarkerId, editorPanel, visibleMapModificationMarkers.length]);

  useEffect(() => {
    if (!copyToastStatus) {
      return;
    }

    const timeout = window.setTimeout(() => setCopyToastStatus(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [copyToastStatus]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    canvas.addEventListener("wheel", handleCanvasWheel, { passive: false });

    return () => {
      canvas.removeEventListener("wheel", handleCanvasWheel);
    };
  });

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
  }, [activeLayoutId, isEditorSetupComplete]);

  useEffect(() => {
    setMapZoom(defaultMapZoom);
    setMapPan({ x: 0, y: 0 });
  }, [defaultMapZoom, activeLayoutId, isEditorSetupComplete, activePhaseId]);

  function editorHasChanges() {
    return (
      playerCount !== 3 ||
      side !== "Defense" ||
      layoutId !== getDefaultLayoutId(selectedMap) ||
      mapModifications.trim().length > 0 ||
      mapModificationMarkers.length > 0 ||
      surfaceAssignments.length > 0 ||
      drawingStrokes.length > 0 ||
      !slotsMatchDefault(slots, playerCount)
    );
  }

  function sideHasResettableChanges() {
    return slots.some((slot) => slot.operators.length > 0 || slot.gadget.trim().length > 0 || slot.gadgets.length > 0);
  }

  function createCurrentPhaseSnapshot(): StratPhaseSnapshot {
    return {
      layoutId,
      playerCount,
      side,
      activeSlot,
      slots,
      mapModifications,
      mapModificationMarkers,
      drawingStrokes,
      surfaceAssignments,
    };
  }

  function saveActivePhaseSnapshot(snapshot: StratPhaseSnapshot = createCurrentPhaseSnapshot()) {
    setPhases((current) =>
      current.map((phase) =>
        phase.id === activePhaseId ? { ...phase, snapshot } : phase,
      ),
    );
  }

  function applyPhaseSnapshot(snapshot: StratPhaseSnapshot) {
    setLayoutId(snapshot.layoutId);
    setPlayerCount(snapshot.playerCount);
    setSide(snapshot.side);
    setActiveSlot(Math.min(snapshot.activeSlot, snapshot.playerCount - 1));
    setSlots(snapshot.slots);
    setMapModifications(snapshot.mapModifications);
    setMapModificationMarkers(snapshot.mapModificationMarkers);
    setDrawingStrokes(snapshot.drawingStrokes);
    setSurfaceAssignments(snapshot.surfaceAssignments);
    setSelectedSurface(null);
    setActiveMapModificationMarkerId(null);
    setPendingGadgetSlotIndex(null);
    setActiveSlotGadgetMarkerId(null);
    setExpandedSlotGadgetMarkerId(null);
    setEditorPanel("slots");
    setMapZoom(defaultMapZoom);
    setMapPan({ x: 0, y: 0 });
  }

  function findJsonMap(strat: StratJson) {
    return (
      maps.find((map) => map.slug === strat.mapSlug) ??
      maps.find((map) => map.name.toLowerCase() === String(strat.map ?? "").trim().toLowerCase()) ??
      maps[0]
    );
  }

  function findJsonLayout(map: TacticalMap, phase: StratJsonPhase, strat: StratJson) {
    const layoutName = phase.layout ?? strat.layout;

    return (
      map.layouts.find((layout) => layout.id === phase.layoutId) ??
      map.layouts.find((layout) => layout.id === strat.layoutId) ??
      map.layouts.find((layout) => layout.label.toLowerCase() === String(layoutName ?? "").trim().toLowerCase()) ??
      map.layouts.find((layout) => layout.image === strat.layoutImage) ??
      map.layouts.find((layout) => layout.id === getDefaultLayoutId(map)) ??
      map.layouts[0]
    );
  }

  function getImportedSide(value: unknown): OperatorSide {
    return value === "Attack" ? "Attack" : "Defense";
  }

  function getImportedModificationType(marker: StratJsonMapModification): ModificationType | null {
    const rawType = String(marker.typeId ?? marker.type ?? "").trim().toLowerCase();
    // Keep label-only legacy exports compatible with the original rotation IDs.
    if (rawType === "standing rotation") return "standing-rotation";
    if (rawType === "vault rotation") return "vault-rotation";

    return (
      allModificationTools.find(
        (tool) => tool.type === rawType || tool.label.toLowerCase() === rawType,
      )?.type ?? null
    );
  }

  function createSnapshotFromJsonPhase(strat: StratJson, phase: StratJsonPhase, map: TacticalMap): StratPhaseSnapshot {
    const importScale = getMapProjectionScale(Number(phase.viewport?.aspectRatio ?? strat.viewport?.aspectRatio), mapCoordinateAspectRatio);
    const importPoint = (point: DrawingPoint) => projectMapPoint({ x: clamp(point.x, 0, 100), y: clamp(point.y, 0, 100) }, importScale);
    const phaseLayout = findJsonLayout(map, phase, strat);
    const importedSlots = phase.slots ?? strat.slots ?? [];
    const importedPlayerCount = clamp(Number(phase.playerCount ?? strat.playerCount ?? importedSlots.length ?? 3), 1, 5);
    const slotsFromJson = createSlots(importedPlayerCount).map((emptySlot, index) => {
      const slot = importedSlots[index];

      if (!slot) {
        return emptySlot;
      }

      const operatorValues = slot.operatorSlugs?.length ? slot.operatorSlugs : slot.operators ?? [];
      const importedOperators = operatorValues
        .map((operator) => getOperatorSlug(operator))
        .filter((operatorSlug): operatorSlug is string => Boolean(operatorSlug))
        .slice(0, 3);

      return {
        role: String(slot.role ?? ""),
        operators: importedOperators,
        gadget: String(slot.gadget ?? ""),
        gadgets: (slot.gadgets ?? [])
          .map((gadget, gadgetIndex): SlotGadgetMarker | null => {
            if (!isPoint(gadget.position)) {
              return null;
            }

            const gadgetLayout =
              map.layouts.find((layout) => layout.id === gadget.layoutId) ??
              map.layouts.find((layout) => layout.label.toLowerCase() === String(gadget.layout ?? "").trim().toLowerCase()) ??
              phaseLayout;
            const imageUrls = Array.from(
              new Set(
                [...(Array.isArray(gadget.imageUrls) ? gadget.imageUrls : []), gadget.iconUrl]
                  .map((url) => String(url ?? "").trim())
                  .filter(Boolean),
              ),
            ).slice(0, 3);

            return {
              id: gadget.id ?? `slot-${index + 1}-gadget-import-${Date.now()}-${gadgetIndex}`,
              type: getPlayerGadgetTool(gadget.type)?.type,
              rotation: Number.isFinite(gadget.rotation) ? Number(gadget.rotation) : 0,
              layoutId: gadgetLayout.id,
              imageUrls,
              description: String(gadget.description ?? ""),
              size: clamp(Number(gadget.size ?? defaultMapModSize), minMapModSize, maxMapModSize),
              ...importPoint(gadget.position),
            };
          })
          .filter((gadget): gadget is SlotGadgetMarker => Boolean(gadget))
          .slice(0, maxSlotGadgets * 2),
        notes: String(slot.notes ?? ""),
        marker: isPoint(slot.position)
          ? {
              ...importPoint(slot.position),
              layoutId:
                map.layouts.find((layout) => layout.id === slot.layoutId)?.id ??
                map.layouts.find((layout) => layout.label.toLowerCase() === String(slot.layout ?? "").trim().toLowerCase())?.id ??
                phaseLayout.id,
            }
          : undefined,
      };
    });
    const importedMarkers = (phase.mapModifications?.markers ?? strat.mapModifications?.markers ?? [])
      .map((marker, index) => {
        const type = getImportedModificationType(marker);

        if (!type || !isPoint(marker.position)) {
          return null;
        }

        const markerLayout =
          map.layouts.find((layout) => layout.id === marker.layoutId) ??
          map.layouts.find((layout) => layout.label.toLowerCase() === String(marker.layout ?? "").trim().toLowerCase()) ??
          phaseLayout;

        return {
          id: `${type}-import-${Date.now()}-${index}`,
          type,
          layoutId: markerLayout.id,
          rotation: Number(marker.rotation ?? 0),
          size: clamp(Number(marker.size ?? defaultMapModSize), minMapModSize, maxMapModSize),
          ...importPoint(marker.position),
        };
      })
      .filter((marker): marker is MapModificationMarker => Boolean(marker));
    const importedDrawings = (phase.drawings ?? strat.drawings ?? [])
      .map((stroke, index): DrawingStroke | null => {
        const strokeLayout =
          map.layouts.find((layout) => layout.id === stroke.layoutId) ??
          map.layouts.find((layout) => layout.label.toLowerCase() === String(stroke.layout ?? "").trim().toLowerCase()) ??
          phaseLayout;
        const points = (stroke.points ?? [])
          .filter(isPoint)
          .map(importPoint);

        if (points.length === 0) {
          return null;
        }

        return {
          id: stroke.id ?? `drawing-import-${Date.now()}-${index}`,
          layoutId: strokeLayout.id,
          color: stroke.color ?? defaultDrawingColor,
          isEraser: Boolean(stroke.isEraser),
          width: clamp(Number(stroke.width ?? defaultDrawingWidth), 1, 22),
          points,
        };
      })
      .filter((stroke): stroke is DrawingStroke => Boolean(stroke));

    return {
      layoutId: phaseLayout.id,
      playerCount: importedPlayerCount,
      side: getImportedSide(phase.side ?? strat.side),
      activeSlot: 0,
      slots: slotsFromJson,
      mapModifications: String(phase.mapModifications?.notes ?? strat.mapModifications?.notes ?? ""),
      mapModificationMarkers: importedMarkers,
      drawingStrokes: importedDrawings,
      surfaceAssignments: parseSurfaceAssignments(phase.mapModifications ? phase.mapModifications.surfaces : strat.mapModifications?.surfaces, map.layouts.map(layout=>layout.id)),
    };
  }

  function getExportJsonText(name = stratName) {
    return JSON.stringify({ ...exportJson, name: name.trim() }, null, 2);
  }

  function getExportFileName(name = stratName) {
    const safeName = name
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "")
      .replace(/\s+/g, " ")
      .replace(/^-|-$/g, "");

    return `${safeName || `R6Strat-${selectedMap?.name ?? mapSlug}-${side}`}-R6StratShare.txt`;
  }

  function requestNamedJsonAction(action: "save" | "export") {
    if (stratName.trim()) {
      void (action === "save" ? copyStratJson(stratName) : exportStratJsonFile(stratName));
      return;
    }

    setStratNameInput("");
    setPendingJsonAction(action);
  }

  function cancelStratNameDialog() {
    setPendingJsonAction(null);
    setStratNameInput("");
  }

  function confirmStratNameDialog() {
    const nextName = stratNameInput.trim();

    if (!nextName) {
      setJsonStatus("Set a strat name first.");
      return;
    }

    setStratName(nextName);
    setPendingJsonAction(null);
    setStratNameInput("");
    void (pendingJsonAction === "export" ? exportStratJsonFile(nextName) : copyStratJson(nextName));
  }

  async function copyStratJson(name = stratName) {
    const json = getExportJsonText(name);

    try {
      await navigator.clipboard.writeText(json);
      setJsonStatus("");
      setCopyToastStatus("Copied");
    } catch {
      setJsonStatus("Copy failed. Select the JSON text manually.");
    }
  }

  async function exportStratJsonFile(name = stratName) {
    const json = getExportJsonText(name);
    const fileName = getExportFileName(name);
    const blob = new Blob([json], { type: "text/plain;charset=utf-8" });
    const saveFilePicker = (
      window as Window & {
        showSaveFilePicker?: (options: {
          suggestedName: string;
          types: Array<{
            description: string;
            accept: Record<string, string[]>;
          }>;
        }) => Promise<{
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }>;
      }
    ).showSaveFilePicker;

    if (saveFilePicker) {
      try {
        const fileHandle = await saveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: "Text file",
              accept: {
                "text/plain": [".txt"],
                "application/json": [".json"],
              },
            },
          ],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        setJsonStatus("Strat JSON exported.");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setJsonStatus("Export canceled.");
          return;
        }
      }
    }

    const fileUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(fileUrl);
    setJsonStatus("Strat JSON downloaded.");
  }

  function importStratJson() {
    try {
      const parsed: unknown = JSON.parse(jsonImport);

      if (!isStratJson(parsed)) {
        throw new Error("JSON must contain a strat object.");
      }

      const importedMap = findJsonMap(parsed);
      setStratName(typeof parsed.name === "string" ? parsed.name : "");
      const importedPhaseInput =
        parsed.phases?.length
          ? parsed.phases.slice(0, maxPhaseCount)
          : [
              {
                label: "Phase 1",
                startsAt: "",
                layoutId: parsed.layoutId,
                layout: parsed.layout,
                side: parsed.side,
                playerCount: parsed.playerCount,
                mapModifications: parsed.mapModifications,
                drawings: parsed.drawings,
                slots: parsed.slots,
              },
            ];
      const nextPhases = importedPhaseInput.map((phase, index) => ({
        id: `phase-${index + 1}`,
        label: phase.label?.trim() || `Phase ${index + 1}`,
        startsAt: phase.startsAt ?? "",
        snapshot: createSnapshotFromJsonPhase(parsed, phase, importedMap),
      }));
      const firstPhase = nextPhases[0] ?? {
        id: "phase-1",
        label: "Phase 1",
        startsAt: "",
        snapshot: createEmptyPhaseSnapshot(getDefaultLayoutId(importedMap)),
      };

      setMapSlug(importedMap.slug);
      setPhases(nextPhases.length ? nextPhases : [firstPhase]);
      setActivePhaseId(firstPhase.id);
      applyPhaseSnapshot(firstPhase.snapshot);
      setPendingMapSlug(null);
      setPendingSide(null);
      setIsDrawingMode(false);
      setIsJsonLoadOpen(false);
      setIsEditorSetupComplete(true);
      setJsonStatus("JSON loaded into editor.");
    } catch (error) {
      setJsonStatus(error instanceof Error ? error.message : "Invalid JSON.");
    }
  }

  function startEditorFromSetup() {
    const nextMap = maps.find((map) => map.slug === setupMapSlug) ?? maps[0];
    const nextLayoutId = getDefaultLayoutId(nextMap);
    const nextPhase = {
      id: "phase-1",
      label: "Phase 1",
      startsAt: "",
      snapshot: createEmptyPhaseSnapshot(nextLayoutId),
    };

    setMapSlug(nextMap.slug);
    setLayoutId(nextLayoutId);
    setPlayerCount(3);
    setSide(setupSide);
    setActiveSlot(0);
    setSlots(createSlots(3));
    setMapModifications("");
    setMapModificationMarkers([]);
    setSurfaceAssignments([]);
    setSelectedSurface(null);
    setActiveMapModificationMarkerId(null);
    setDrawingStrokes([]);
    setIsDrawingMode(false);
    setPhases([nextPhase]);
    setActivePhaseId(nextPhase.id);
    setMapZoom(defaultMapZoom);
    setMapPan({ x: 0, y: 0 });
    setEditorPanel("slots");
    setPendingMapSlug(null);
    setPendingSide(null);
    setOpenDropdown(null);
    setIsEditorSetupComplete(true);
  }

  function updatePhaseStart(phaseId: string, startsAt: string) {
    setPhases((current) =>
      current.map((phase) =>
        phase.id === phaseId ? { ...phase, startsAt } : phase,
      ),
    );
  }

  function updatePhaseLabel(phaseId: string, label: string) {
    setPhases((current) =>
      current.map((phase) =>
        phase.id === phaseId ? { ...phase, label } : phase,
      ),
    );
  }

  function addPhase() {
    if (phases.length >= maxPhaseCount) {
      return;
    }

    const currentSnapshot = createCurrentPhaseSnapshot();
    const phaseNumber = phases.length + 1;
    const nextPhase: StratPhase = {
      id: `phase-${Date.now()}`,
      label: `Phase ${phaseNumber}`,
      startsAt: "",
      snapshot: {
        ...currentSnapshot,
        drawingStrokes: [],
      },
    };

    setPhases((current) => [
      ...current.map((phase) =>
        phase.id === activePhaseId ? { ...phase, snapshot: currentSnapshot } : phase,
      ),
      nextPhase,
    ]);
    setActivePhaseId(nextPhase.id);
    applyPhaseSnapshot(nextPhase.snapshot);
    setIsDrawingMode(false);
    closeDropdown();
  }

  function stopEditingPhase() {
    setEditingPhaseId(null);
  }

  function removePhase(phaseId: string) {
    if (phaseId === "phase-1" || phases.length <= 1) {
      return;
    }

    const phaseIndex = phases.findIndex((phase) => phase.id === phaseId);

    if (phaseIndex < 0) {
      return;
    }

    const currentSnapshot = createCurrentPhaseSnapshot();
    const savedPhases = phases.map((phase) =>
      phase.id === activePhaseId ? { ...phase, snapshot: currentSnapshot } : phase,
    );
    const nextPhases = savedPhases.filter((phase) => phase.id !== phaseId);
    const nextActivePhase =
      phaseId === activePhaseId
        ? nextPhases[Math.max(0, phaseIndex - 1)] ?? nextPhases[0]
        : savedPhases.find((phase) => phase.id === activePhaseId);

    setPhases(nextPhases);

    if (nextActivePhase && nextActivePhase.id !== activePhaseId) {
      setActivePhaseId(nextActivePhase.id);
      applyPhaseSnapshot(nextActivePhase.snapshot);
    }

    closeDropdown();
  }

  function changePhase(nextPhaseId: string) {
    if (nextPhaseId === activePhaseId) {
      return;
    }

    const nextPhase = phases.find((phase) => phase.id === nextPhaseId);

    if (!nextPhase) {
      return;
    }

    saveActivePhaseSnapshot();
    setActivePhaseId(nextPhase.id);
    applyPhaseSnapshot(nextPhase.snapshot);
    closeDropdown();
  }

  function applyMapChange(nextSlug: string) {
    const nextMap = maps.find((map) => map.slug === nextSlug) ?? maps[0];

    if (nextMap.slug === mapSlug) {
      setPendingMapSlug(null);
      return;
    }

    setMapSlug(nextMap.slug);
    setLayoutId(getDefaultLayoutId(nextMap));
    setPlayerCount(3);
    setSide("Defense");
    setActiveSlot(0);
    setSlots(createSlots(3));
    setMapModifications("");
    setMapModificationMarkers([]);
    setSurfaceAssignments([]);
    setSelectedSurface(null);
    setActiveMapModificationMarkerId(null);
    setPendingGadgetSlotIndex(null);
    setActiveSlotGadgetMarkerId(null);
    setExpandedSlotGadgetMarkerId(null);
    setDrawingStrokes([]);
    setIsDrawingMode(false);
    setEditorPanel("slots");
    setPhases([
      {
        id: "phase-1",
        label: "Phase 1",
        startsAt: "",
        snapshot: createEmptyPhaseSnapshot(getDefaultLayoutId(nextMap)),
      },
    ]);
    setActivePhaseId("phase-1");
    setMapZoom(defaultMapZoom);
    setMapPan({ x: 0, y: 0 });
    setPendingMapSlug(null);
    setPendingSide(null);
    setPendingGadgetSlotIndex(null);
    setActiveSlotGadgetMarkerId(null);
    setExpandedSlotGadgetMarkerId(null);
  }

  function requestMapChange(nextSlug: string) {
    const nextMap = maps.find((map) => map.slug === nextSlug) ?? maps[0];

    if (nextMap.slug === mapSlug) {
      return;
    }

    if (editorHasChanges()) {
      setPendingMapSlug(nextMap.slug);
      return;
    }

    applyMapChange(nextMap.slug);
  }

  function applySideChange(nextSide: OperatorSide) {
    if (nextSide === side) {
      setPendingSide(null);
      return;
    }

    setSide(nextSide);
    if (nextSide !== "Defense") {
      setEditorPanel("slots");
      setActiveMapModificationMarkerId(null);
    }
    setSlots((current) =>
      current.map((slot) => ({
        ...slot,
        operators: [],
        gadget: "",
        gadgets: [],
      })),
    );
    setPendingSide(null);
    setPendingGadgetSlotIndex(null);
    setActiveSlotGadgetMarkerId(null);
    setExpandedSlotGadgetMarkerId(null);
  }

  function requestSideChange(nextSide: OperatorSide) {
    if (nextSide === side) {
      return;
    }

    if (sideHasResettableChanges()) {
      setPendingSide(nextSide);
      return;
    }

    applySideChange(nextSide);
  }

  function updateLayout(nextLayoutId: string) {
    setLayoutId(nextLayoutId);
    setActiveMapModificationMarkerId(null);
    setMapZoom(defaultMapZoom);
    setMapPan({ x: 0, y: 0 });
  }

  function updatePlayerCount(nextCount: number) {
    setPlayerCount(nextCount);
    setActiveSlot((current) => Math.min(current, nextCount - 1));
    setPendingGadgetSlotIndex((current) => (current === null ? null : Math.min(current, nextCount - 1)));
    setActiveSlotGadgetMarkerId(null);
    setExpandedSlotGadgetMarkerId(null);
    setEditorPanel("slots");
    setSlots((current) =>
      Array.from({ length: nextCount }, (_, index) => current[index] ?? createSlots(nextCount)[index]),
    );
  }

  function updateSlot(index: number, patch: Partial<SlotState>) {
    setSlots((current) =>
      current.map((slot, slotIndex) =>
        slotIndex === index ? { ...slot, ...patch } : slot,
      ),
    );
  }

  function resetSlot(index: number) {
    const [emptySlot] = createSlots(1);

    setSlots((current) =>
      current.map((slot, slotIndex) => (slotIndex === index ? emptySlot : slot)),
    );
    setPendingGadgetSlotIndex((current) => (current === index ? null : current));
    setActiveSlotGadgetMarkerId(null);
    setExpandedSlotGadgetMarkerId(null);
  }

  function toggleOperator(slug: string) {
    const current = slots[activeSlot]?.operators ?? [];
    const next = current.includes(slug)
      ? current.filter((operatorSlug) => operatorSlug !== slug)
      : current.length < 3
        ? [...current, slug]
        : current;
    updateSlot(activeSlot, { operators: next });
  }

  function removeSelectedOperator(slug: string) {
    const current = slots[activeSlot]?.operators ?? [];
    updateSlot(activeSlot, {
      operators: current.filter((operatorSlug) => operatorSlug !== slug),
    });
  }

  function startSlotGadgetPlacement(type?: PlayerGadgetType) {
    const slot = slots[activeSlot];

    if (!slot || slot.gadgets.filter(gadget => Boolean(gadget.type) === Boolean(type)).length >= maxSlotGadgets) {
      return;
    }

    setEditorPanel("slots");
    setIsDrawingMode(false);
    setShowPlayerGadgetMenu(false);
    suppressNextClick.current = false;
    setPendingPlayerGadgetType(type);
    setActiveSlotGadgetMarkerId(null);
    setPendingGadgetSlotIndex((current) => (current === activeSlot && pendingPlayerGadgetType === type ? null : activeSlot));
  }

  function addSlotGadgetMarker(slotIndex: number, point: DrawingPoint) {
    setSlots((current) =>
      current.map((slot, index) =>
        index === slotIndex && slot.gadgets.filter(gadget => Boolean(gadget.type) === Boolean(pendingPlayerGadgetType)).length < maxSlotGadgets
          ? {
              ...slot,
              gadgets: [
                ...slot.gadgets,
                {
                  id: `slot-${slotIndex + 1}-gadget-${Date.now()}-${slot.gadgets.length}`,
                  type: pendingPlayerGadgetType,
                  rotation: 0,
                  layoutId: activeLayoutId,
                  imageUrls: [],
                  description: "",
                  size: defaultMapModSize,
                  x: point.x,
                  y: point.y,
                },
              ],
            }
          : slot,
      ),
    );
    setActiveSlotGadgetMarkerId(null);
    setPendingGadgetSlotIndex((current) => {
      const slot = slots[slotIndex];
      return current === slotIndex && slot && slot.gadgets.filter(gadget => Boolean(gadget.type) === Boolean(pendingPlayerGadgetType)).length + 1 < maxSlotGadgets ? slotIndex : null;
    });
  }

  function selectSlotGadgetMarker(
    event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>,
    slotIndex: number,
    id: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setActiveSlot(slotIndex);
    setEditorPanel("slots");
    setPendingGadgetSlotIndex(null);
    setActiveSlotGadgetMarkerId(id);
    setExpandedSlotGadgetMarkerId(id);
  }

  function moveSlotGadgetMarker(slotIndex: number, id: string, point: DrawingPoint) {
    setSlots((current) =>
      current.map((slot, index) =>
        index === slotIndex
          ? {
              ...slot,
              gadgets: slot.gadgets.map((gadget) =>
                gadget.id === id ? { ...gadget, x: point.x, y: point.y, layoutId: activeLayoutId } : gadget,
              ),
            }
          : slot,
      ),
    );
  }

  function updateSlotGadgetMarker(slotIndex: number, id: string, patch: Partial<SlotGadgetMarker>) {
    setSlots((current) =>
      current.map((slot, index) =>
        index === slotIndex
          ? {
              ...slot,
              gadgets: slot.gadgets.map((gadget) => (gadget.id === id ? { ...gadget, ...patch } : gadget)),
            }
          : slot,
      ),
    );
  }

  function resizeSlotGadgetMarker(slotIndex: number, id: string, direction: 1 | -1) {
    setSlots((current) =>
      current.map((slot, index) =>
        index === slotIndex
          ? {
              ...slot,
              gadgets: slot.gadgets.map((gadget) =>
                gadget.id === id
                  ? {
                      ...gadget,
                      size: Number(
                        clamp(
                          gadget.size + direction * mapModSizeStep,
                          minMapModSize,
                          maxMapModSize,
                        ).toFixed(2),
                      ),
                    }
                  : gadget,
              ),
            }
          : slot,
      ),
    );
  }

  function updateSlotGadgetImageUrl(slotIndex: number, id: string, imageIndex: number, value: string) {
    setSlots((current) =>
      current.map((slot, index) =>
        index === slotIndex
          ? {
              ...slot,
              gadgets: slot.gadgets.map((gadget) => {
                if (gadget.id !== id) {
                  return gadget;
                }

                const imageUrls = [...gadget.imageUrls];
                imageUrls[imageIndex] = value;
                const lastFilledIndex = imageUrls.reduce((lastIndex, url, urlIndex) => (url.trim() ? urlIndex : lastIndex), -1);

                return {
                  ...gadget,
                  imageUrls: lastFilledIndex >= 0 ? imageUrls.slice(0, Math.min(lastFilledIndex + 1, 3)) : [],
                };
              }),
            }
          : slot,
      ),
    );
  }

  function reorderSlotGadget(id: string, targetId: string) {
    setSlots(current => current.map((slot, index) => index === activeSlot
      ? { ...slot, gadgets: reorderSlotEquipment(slot.gadgets, id, targetId) }
      : slot));
    setEquipmentOrderStatus("Equipment order updated.");
  }

  function removeSlotGadgetMarker(slotIndex: number, id: string) {
    setSlots((current) =>
      current.map((slot, index) =>
        index === slotIndex
          ? {
              ...slot,
              gadgets: slot.gadgets.filter((gadget) => gadget.id !== id),
            }
          : slot,
      ),
    );
    setActiveSlotGadgetMarkerId((current) => (current === id ? null : current));
    setExpandedSlotGadgetMarkerId((current) => (current === id ? null : current));
  }

  function startSlotGadgetDrag(event: PointerEvent<HTMLSpanElement>, slotIndex: number, id: string) {
    const gadget = slots[slotIndex]?.gadgets.find((item) => item.id === id);

    if (gadget?.layoutId && gadget.layoutId !== activeLayoutId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setActiveSlot(slotIndex);
    setEditorPanel("slots");
    setPendingGadgetSlotIndex(null);
    setActiveSlotGadgetMarkerId(id);
    slotGadgetDragState.current = {
      slotIndex,
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveSlotGadgetDrag(event: PointerEvent<HTMLSpanElement>) {
    const drag = slotGadgetDragState.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const hasMoved = Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3;

    if (!drag.moved && !hasMoved) {
      return;
    }

    drag.moved = true;
    suppressNextClick.current = true;
    const point = getMapPointFromClient(event.clientX, event.clientY);

    if (point) {
      moveSlotGadgetMarker(drag.slotIndex, drag.id, point);
    }
  }

  function endSlotGadgetDrag(event: PointerEvent<HTMLSpanElement>) {
    const drag = slotGadgetDragState.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (drag.moved) {
      suppressNextClick.current = true;
    }
    slotGadgetDragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function getMapPointFromClient(clientX: number, clientY: number) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return null;
    const pointerX = clientX - rect.left - canvas.clientLeft;
    const pointerY = clientY - rect.top - canvas.clientTop;
    const layerX = width / 2 + (pointerX - mapPan.x - width / 2) / mapZoom;
    const layerY = height / 2 + (pointerY - mapPan.y - height / 2) / mapZoom;

    return projectMapPoint({
      x: (clamp(layerX, 0, width) / width) * 100,
      y: (clamp(layerY, 0, height) / height) * 100,
    }, getMapProjectionScale(width / height, mapCoordinateAspectRatio));
  }

  function getMapPoint(event: MouseEvent<HTMLDivElement> | DragEvent<HTMLDivElement>) {
    return getMapPointFromClient(event.clientX, event.clientY);
  }

  function addMapModificationMarker(type: ModificationType, point: SlotMarker) {
    if (!isDefenseSide) {
      return;
    }

    const id = `${type}-${Date.now()}-${mapModificationMarkers.length}`;
    setMapModificationMarkers((current) => [
      ...current,
      {
        id,
        type,
        layoutId: activeLayoutId,
        rotation: 0,
        size: defaultMapModSize,
        x: point.x,
        y: point.y,
      },
    ]);
    setActiveMapModificationMarkerId(id);
  }

  function removeMapModificationMarker(id: string) {
    setMapModificationMarkers((current) => current.filter((marker) => marker.id !== id));
    setActiveMapModificationMarkerId((current) => (current === id ? null : current));
  }

  function selectMapModificationMarker(
    event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>,
    id: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setActiveMapModificationMarkerId(id);
    setEditorPanel("map-modifications");
  }

  function rotateMapModificationMarker(id: string, degrees: number) {
    setMapModificationMarkers((current) =>
      current.map((marker) =>
        marker.id === id ? { ...marker, rotation: (marker.rotation + degrees) % 360 } : marker,
      ),
    );
  }

  function resizeMapModificationMarker(id: string, direction: 1 | -1) {
    setMapModificationMarkers((current) =>
      current.map((marker) =>
        marker.id === id
          ? {
              ...marker,
              size: Number(
                clamp(
                  marker.size + direction * mapModSizeStep,
                  minMapModSize,
                  maxMapModSize,
                ).toFixed(2),
              ),
            }
          : marker,
      ),
    );
  }

  function moveMapModificationMarker(id: string, point: SlotMarker) {
    setMapModificationMarkers((current) =>
      current.map((marker) => (marker.id === id ? { ...marker, x: point.x, y: point.y } : marker)),
    );
  }

  function undoDrawingStroke() {
    setDrawingStrokes((current) => {
      const lastVisibleIndex = current.map((stroke) => stroke.layoutId).lastIndexOf(activeLayoutId);

      if (lastVisibleIndex < 0) {
        return current;
      }

      return current.filter((_, index) => index !== lastVisibleIndex);
    });
  }

  function startDrawingStroke(event: PointerEvent<HTMLDivElement>) {
    const point = getMapPointFromClient(event.clientX, event.clientY);

    if (!point) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const id = `drawing-${Date.now()}-${drawingStrokes.length}`;
    drawingDragState.current = { id, pointerId: event.pointerId };
    suppressNextClick.current = true;
    setDrawingStrokes((current) => [
      ...current,
      {
        id,
        layoutId: activeLayoutId,
        color: isEraserMode ? "#000000" : drawingColor,
        isEraser: isEraserMode,
        width: drawingWidth,
        points: [point],
      },
    ]);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function appendDrawingPoint(event: PointerEvent<HTMLDivElement>) {
    const drag = drawingDragState.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const point = getMapPointFromClient(event.clientX, event.clientY);

    if (!point) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressNextClick.current = true;
    setDrawingStrokes((current) =>
      current.map((stroke) =>
        stroke.id === drag.id
          ? {
              ...stroke,
              points: [...stroke.points, point],
            }
          : stroke,
      ),
    );
  }

  function endDrawingStroke(event: PointerEvent<HTMLDivElement>) {
    const drag = drawingDragState.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressNextClick.current = true;
    drawingDragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function placeMarker(event: MouseEvent<HTMLDivElement>) {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }

    if (isDrawingMode) {
      return;
    }

    if (selectedSurface) {
      setSelectedSurface(null);
      return;
    }

    const point = getMapPoint(event);

    if (!point) {
      return;
    }

    if (pendingGadgetSlotIndex !== null) {
      addSlotGadgetMarker(pendingGadgetSlotIndex, point);
      return;
    }

    if (editorPanel === "map-modifications" && isDefenseSide) {
      addMapModificationMarker(activeModificationType, point);
      return;
    }

    if (slots[activeSlot]?.marker) {
      return;
    }

    updateSlot(activeSlot, { marker: { ...point, layoutId: activeLayoutId } });
  }

  function dragModification(event: DragEvent<HTMLButtonElement>, type: ModificationType) {
    event.dataTransfer.setData("text/plain", type);
    event.dataTransfer.effectAllowed = "copy";
    setActiveModificationType(type);
  }

  function allowModificationDrop(event: DragEvent<HTMLDivElement>) {
    if (editorPanel !== "map-modifications" || !isDefenseSide) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function dropModification(event: DragEvent<HTMLDivElement>) {
    if (editorPanel !== "map-modifications" || !isDefenseSide) {
      return;
    }

    event.preventDefault();
    const droppedType = event.dataTransfer.getData("text/plain") as ModificationType;
    const type = modificationTools.some((tool) => tool.type === droppedType)
      ? droppedType
      : activeModificationType;
    const point = getMapPoint(event);

    if (point) {
      addMapModificationMarker(type, point);
    }
  }

  function startMapModificationDrag(event: PointerEvent<HTMLSpanElement>, id: string) {
    const marker = mapModificationMarkers.find((item) => item.id === id);

    if (marker && marker.layoutId !== activeLayoutId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setActiveMapModificationMarkerId(id);
    setEditorPanel("map-modifications");
    mapModificationDragState.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveMapModificationDrag(event: PointerEvent<HTMLSpanElement>) {
    const drag = mapModificationDragState.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const hasMoved = Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3;

    if (!drag.moved && !hasMoved) {
      return;
    }

    drag.moved = true;
    suppressNextClick.current = true;
    const point = getMapPointFromClient(event.clientX, event.clientY);

    if (point) {
      moveMapModificationMarker(drag.id, point);
    }
  }

  function endMapModificationDrag(event: PointerEvent<HTMLSpanElement>) {
    const drag = mapModificationDragState.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (drag.moved) {
      suppressNextClick.current = true;
    }
    mapModificationDragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function startSlotMarkerDrag(event: PointerEvent<HTMLSpanElement>, index: number) {
    const marker = slots[index]?.marker;

    if (marker?.layoutId && marker.layoutId !== activeLayoutId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setActiveSlot(index);
    setEditorPanel("slots");
    slotMarkerDragState.current = {
      index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveSlotMarkerDrag(event: PointerEvent<HTMLSpanElement>) {
    const drag = slotMarkerDragState.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const hasMoved = Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3;

    if (!drag.moved && !hasMoved) {
      return;
    }

    drag.moved = true;
    suppressNextClick.current = true;
    const point = getMapPointFromClient(event.clientX, event.clientY);

    if (point) {
      updateSlot(drag.index, { marker: { ...point, layoutId: activeLayoutId } });
    }
  }

  function endSlotMarkerDrag(event: PointerEvent<HTMLSpanElement>) {
    const drag = slotMarkerDragState.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (drag.moved) {
      suppressNextClick.current = true;
    }
    slotMarkerDragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleCanvasWheel(event: WheelEvent) {
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
    if (isDrawingMode) {
      startDrawingStroke(event);
      return;
    }

    if (mapZoom <= minimumMapZoom) {
      return;
    }

    event.preventDefault();
    dragState.current = {
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
    if (isDrawingMode) {
      appendDrawingPoint(event);
      return;
    }

    const drag = dragState.current;
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
      suppressNextClick.current = true;
      setIsPanning(true);
    }

    setMapPan({
      x: drag.originX + deltaX,
      y: drag.originY + deltaY,
    });
  }

  function endCanvasPan(event: PointerEvent<HTMLDivElement>) {
    if (isDrawingMode) {
      endDrawingStroke(event);
      return;
    }

    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (drag.moved) {
      suppressNextClick.current = true;
    }

    dragState.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const exportJson = {
    name: stratName.trim(),
    map: selectedMap?.name,
    mapSlug,
    layout: selectedLayout?.label,
    layoutId: selectedLayout?.id,
    layoutImage: selectedLayout?.image,
    side,
    playerCount,
    viewport: {
      aspectRatio: mapCoordinateAspectRatio,
    },
    mapModifications: {
      notes: mapModifications,
      surfaces: surfaceAssignments,
      markers: mapModificationMarkers.map((marker) => ({
        type: getModificationLabel(marker.type),
        typeId: marker.type,
        layoutId: marker.layoutId,
        layout: selectedMap?.layouts.find((layout) => layout.id === marker.layoutId)?.label ?? marker.layoutId,
        rotation: marker.rotation,
        size: marker.size,
        position: { x: marker.x, y: marker.y },
      })),
    },
    drawings: drawingStrokes.map((stroke) => ({
      layoutId: stroke.layoutId,
      layout: selectedMap?.layouts.find((layout) => layout.id === stroke.layoutId)?.label ?? stroke.layoutId,
      color: stroke.color,
      isEraser: Boolean(stroke.isEraser),
      width: stroke.width,
      points: stroke.points,
    })),
    slots: slots.map((slot, index) => ({
      slot: index + 1,
      role: slot.role,
      operatorSlugs: slot.operators,
      operators: slot.operators.map((slug) => getOperator(slug)?.name ?? slug),
      layoutId: slot.marker?.layoutId,
      layout: slot.marker?.layoutId
        ? selectedMap?.layouts.find((layout) => layout.id === slot.marker?.layoutId)?.label ?? slot.marker.layoutId
        : undefined,
      position: slot.marker ?? null,
      gadget: slot.gadget,
      gadgets: slot.gadgets.map((gadget) => ({
        id: gadget.id,
        type: gadget.type,
        rotation: gadget.rotation,
        layoutId: gadget.layoutId,
        layout: selectedMap?.layouts.find((layout) => layout.id === gadget.layoutId)?.label ?? gadget.layoutId,
        iconUrl: gadget.imageUrls[0] ?? "",
        imageUrls: gadget.imageUrls.filter((url) => url.trim()).slice(0, 3),
        description: gadget.description,
        size: gadget.size,
        position: { x: gadget.x, y: gadget.y },
      })),
      notes: slot.notes,
    })),
    phases: phases.map((phase) => {
      const snapshot = phase.id === activePhaseId ? createCurrentPhaseSnapshot() : phase.snapshot;

      return {
        label: phase.label,
        startsAt: phase.startsAt,
        viewport: {
          aspectRatio: mapCoordinateAspectRatio,
        },
        layoutId: snapshot.layoutId,
        side: snapshot.side,
        playerCount: snapshot.playerCount,
        mapModifications: {
          notes: snapshot.mapModifications,
          surfaces: snapshot.surfaceAssignments,
          markers: snapshot.mapModificationMarkers.map((marker) => ({
            type: getModificationLabel(marker.type),
            typeId: marker.type,
            layoutId: marker.layoutId,
            layout: selectedMap?.layouts.find((layout) => layout.id === marker.layoutId)?.label ?? marker.layoutId,
            rotation: marker.rotation,
            size: marker.size,
            position: { x: marker.x, y: marker.y },
          })),
        },
        drawings: snapshot.drawingStrokes.map((stroke) => ({
          layoutId: stroke.layoutId,
          layout: selectedMap?.layouts.find((layout) => layout.id === stroke.layoutId)?.label ?? stroke.layoutId,
          color: stroke.color,
          isEraser: Boolean(stroke.isEraser),
          width: stroke.width,
          points: stroke.points,
        })),
        slots: snapshot.slots.map((slot, index) => ({
          slot: index + 1,
          role: slot.role,
          operatorSlugs: slot.operators,
          operators: slot.operators.map((slug) => getOperator(slug)?.name ?? slug),
          layoutId: slot.marker?.layoutId,
          layout: slot.marker?.layoutId
            ? selectedMap?.layouts.find((layout) => layout.id === slot.marker?.layoutId)?.label ?? slot.marker.layoutId
            : undefined,
          position: slot.marker ?? null,
          gadget: slot.gadget,
          gadgets: slot.gadgets.map((gadget) => ({
            id: gadget.id,
            type: gadget.type,
            rotation: gadget.rotation,
            layoutId: gadget.layoutId,
            layout: selectedMap?.layouts.find((layout) => layout.id === gadget.layoutId)?.label ?? gadget.layoutId,
            iconUrl: gadget.imageUrls[0] ?? "",
            imageUrls: gadget.imageUrls.filter((url) => url.trim()).slice(0, 3),
            description: gadget.description,
            size: gadget.size,
            position: { x: gadget.x, y: gadget.y },
          })),
          notes: slot.notes,
        })),
      };
    }),
  };

  function closeDropdown() {
    if (openDropdown === "setup-map" || openDropdown === "setup-side") {
      setHasOpenedSetupSelection(true);
    }

    setOpenDropdown(null);
    setEditingPhaseId(null);
  }

  function renderDropdown(
    id: string,
    label: string,
    value: string | number | undefined,
    options: SelectOption[],
    onSelect: (value: string) => void,
  ) {
    const selected = options.find((option) => option.value === String(value)) ?? options[0];
    const isOpen = openDropdown === id;

    return (
      <div className="custom-select-field">
        <span>{label}</span>
        <div className="custom-select" onBlur={closeDropdown}>
          <button
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            className="custom-select-trigger"
            onClick={() => {
              if ((id === "setup-map" || id === "setup-side") && openDropdown === id) {
                setHasOpenedSetupSelection(true);
              }

              setOpenDropdown((current) => (current === id ? null : id));
            }}
            type="button"
          >
            {selected?.label ?? ""}
          </button>
          {isOpen ? (
            <div aria-label={`${label} options`} className="custom-select-menu" role="listbox">
              {options.map((option) => (
                <button
                  aria-selected={option.value === String(value)}
                  className={option.value === String(value) ? "selected" : ""}
                  key={option.value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect(option.value);
                    closeDropdown();
                  }}
                  role="option"
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (!isEditorSetupComplete) {
    return (
      <div className="strat-builder">
        <div className="editor-entry" data-fd-id="section-editor-start">
          <header className="entry-head">
            <h1 data-fd-id="text-editor-title">Strat Editor</h1>
            <p data-fd-id="text-editor-intro">Choose your map and side. Build the round from there.</p>
          </header>
        <section className="editor-setup-panel" aria-label="Start a new strat" data-fd-id="section-new-strat">
          <div className="entry-map">
          <div
            aria-label={`${setupMap?.name ?? "Selected"} map preview`}
            className="editor-setup-map-preview"
            role="img"
            style={getMapPreviewStyle(setupMap)}
          />
          </div>
          <div className="entry-options">
          <div className="entry-field" data-fd-id="field-start-map">
            {renderDropdown(
              "setup-map",
              "Map",
              setupMapSlug,
              maps.map((map) => ({ label: map.name, value: map.slug })),
              setSetupMapSlug,
            )}
          </div>
          <fieldset className="entry-side" data-fd-id="field-start-side">
            <legend>Side</legend>
            <div className="entry-side-buttons">
              {(["Defense", "Attack"] as const).map(side => <button type="button" key={side} aria-pressed={setupSide === side} onClick={() => setSetupSide(side)} data-fd-id={`btn-side-${side.toLowerCase()}`}>
                <SetupSideIcon side={side} watermark /><SetupSideIcon side={side} />
                <span><strong>{side}</strong><small>{side === "Defense" ? "Hold the site" : "Take the site"}</small></span>
              </button>)}
            </div>
          </fieldset>
          <div className="entry-start">
            <button
              className="entry-primary"
              onClick={startEditorFromSetup}
              type="button"
              data-fd-id="btn-start-editor"
            >
              <span>Start Editor</span><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>
            </button>
          </div>
          </div>
        </section>
        <section className="entry-resume" data-fd-id="section-load-existing">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6" /></svg>
          <div><strong>Continue an existing strat</strong><p>Open a saved JSON export in the editor.</p></div>
          <button type="button" onClick={() => setIsJsonLoadOpen(true)} data-fd-id="btn-open-json">Load JSON <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-5-5 5 5-5 5" /></svg></button>
        </section>
        </div>

        {isJsonLoadOpen ? (
          <div className="json-load-backdrop" role="presentation">
            <section aria-labelledby="json-load-title" className="json-load-dialog" role="dialog" aria-modal="true">
              <header>
                <div>
                  <span>Paste strat JSON to continue editing</span>
                  <h3 id="json-load-title">Continue editing a saved strat</h3>
                </div>
                <button aria-label="Close JSON load dialog" onClick={() => setIsJsonLoadOpen(false)} type="button">
                  X
                </button>
              </header>
              <p>
                Paste a saved R6 StratShare JSON export here. Loading it will replace the current editor state.
              </p>
              <textarea
                onChange={(event) => setJsonImport(event.target.value)}
                placeholder="{ ... }"
                value={jsonImport}
              />
              <div className="json-load-dialog-actions">
                <button onClick={() => setIsJsonLoadOpen(false)} type="button">
                  Cancel
                </button>
                <button onClick={importStratJson} type="button">
                  Load JSON
                </button>
              </div>
              {jsonStatus ? <span className="json-load-status">{jsonStatus}</span> : null}
            </section>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="strat-builder">
      <div className="builder-canvas-grid">
        <aside className="layout-settings-rail" aria-label="Layout settings">
          <span className="layout-settings-kicker">Setup</span>
          <div className="layout-settings-controls">
            <div className="phase-controls">
              <div className="custom-select-field phase-select-field">
                <span>Phase</span>
                <div
                  className="custom-select"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      closeDropdown();
                    }
                  }}
                >
                  <button
                    aria-expanded={openDropdown === "phase"}
                    aria-haspopup="listbox"
                    className="custom-select-trigger"
                    onClick={() => setOpenDropdown((current) => (current === "phase" ? null : "phase"))}
                    type="button"
                  >
                    {activePhaseTriggerLabel}
                  </button>
                  {openDropdown === "phase" ? (
                    <div aria-label="Phase options" className="custom-select-menu phase-menu" role="listbox">
                      {phaseOptions.map((option) => (
                        <div className="phase-option-row" key={option.value}>
                          {editingPhaseId === option.value ? (
                            <input
                              aria-label={`Rename ${option.label}`}
                              autoFocus
                              className="phase-name-input"
                              onBlur={stopEditingPhase}
                              onChange={(event) => updatePhaseLabel(option.value, event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === "Escape") {
                                  stopEditingPhase();
                                }
                              }}
                              onMouseDown={(event) => event.stopPropagation()}
                              value={option.label}
                            />
                          ) : (
                            <button
                              aria-selected={option.value === activePhaseId}
                              className={option.value === activePhaseId ? "selected phase-option-main" : "phase-option-main"}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                if (option.value === activePhaseId) {
                                  setEditingPhaseId(option.value);
                                  return;
                                }

                                changePhase(option.value);
                              }}
                              role="option"
                              title={option.value === activePhaseId ? "Click to rename" : "Click to select"}
                              type="button"
                            >
                              {option.label}
                            </button>
                          )}
                          <input
                            aria-label={`${option.label} starts at`}
                            className="phase-start-input"
                            onChange={(event) => updatePhaseStart(option.value, event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            placeholder="0:00"
                            value={option.startsAt}
                          />
                          {option.value !== "phase-1" ? (
                            <button
                              aria-label={`Delete ${option.label}`}
                              className="remove-phase"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={(event) => {
                                event.stopPropagation();
                                removePhase(option.value);
                              }}
                              title={`Delete ${option.label}`}
                              type="button"
                            >
                              X
                            </button>
                          ) : null}
                        </div>
                      ))}
                      <button
                        className="add-phase-option"
                        disabled={phases.length >= maxPhaseCount}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={addPhase}
                        type="button"
                      >
                        {phases.length >= maxPhaseCount ? "Phase limit reached" : "Add Phase"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            {renderDropdown(
              "floor",
              "Floor",
              selectedLayout?.id,
              selectedMap?.layouts.map((layout) => ({ label: layout.label, value: layout.id })) ?? [],
              updateLayout,
            )}
            {renderDropdown(
              "players",
              "Players",
              playerCount,
              [1, 2, 3, 4, 5].map((count) => ({ label: String(count), value: String(count) })),
              (value) => updatePlayerCount(Number(value)),
            )}
          </div>
        </aside>
        <div className="map-workbench">
          <div
            className={`layout-canvas${mapZoom > minimumMapZoom ? " is-zoomed" : ""}${isPanning ? " is-panning" : ""}${isDrawingMode ? " is-drawing" : ""}`}
            ref={canvasRef}
            onClick={placeMarker}
            onPointerDown={startCanvasPan}
            onPointerMove={moveCanvasPan}
            onPointerUp={endCanvasPan}
            onPointerCancel={endCanvasPan}
            onDragOver={allowModificationDrop}
            onDrop={dropModification}
            role="button"
            tabIndex={0}
            aria-label="Mark the active slot position on the map. Use the mouse wheel to zoom and drag while zoomed to move the layout."
          >
            {copyToastStatus ? (
              <span aria-live="polite" className="layout-copy-toast">
                {copyToastStatus}
              </span>
            ) : null}
            {isDefenseSide && !isDrawingMode && !selectedSurface ? (
              <div hidden className="surface-review-controls" onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}>
                <button type="button" aria-pressed={reviewSurfaces} onClick={()=>setReviewSurfaces(current=>!current)}>Review surfaces</button>
                {reviewSurfaces ? <span>{surfaceLayout?.features.filter(item=>item.kind==="wall").length ?? 0} walls · {surfaceLayout?.features.filter(item=>item.kind==="hatch").length ?? 0} hatches{surfaceLayout?.features.some(item=>item.needsReview) ? ` · Check: ${surfaceLayout.features.flatMap((item,index)=>item.needsReview ? [index+1] : []).join(", ")}` : ""}</span> : null}
              </div>
            ) : null}
            {isDefenseSide && reinforcementCount > 0 ? (
              <span className="reinforcement-counter" role="status" aria-label="Reinforced walls and hatches in the current phase across all floors">
                Reinforced <strong>{reinforcementCount}</strong>
              </span>
            ) : null}
            {selectedSurface && isDefenseSide && !isDrawingMode ? (
              <MapSurfaceMenu surface={selectedSurface} number={(surfaceLayout?.features.findIndex(item=>item.id===selectedSurface.id) ?? -1)+1} action={selectedSurfaceAssignment?.action} position={selectedSurfaceAssignment?.position} advancedMode={advancedMode} onClose={()=>setSelectedSurface(null)} onChange={(action,position)=>{const target=getSurfaceAssignmentTarget(activeLayoutId,selectedSurface);setSurfaceAssignments(current=>setSurfaceAssignment(current,target.layoutId,target.surfaceId,action,position));setSelectedSurface(null);}} />
            ) : null}
            <span
              className="layout-pan-layer"
              style={{ transform: `translate(${mapPan.x}px, ${mapPan.y}px)` }}
            >
              <span
                className="layout-zoom-layer"
                style={{ transform: `scale(${mapZoom})` }}
              >
                {selectedLayout ? (
                  <MapLayoutImage
                    layout={selectedLayout}
                    map={selectedMap}
                    showBombsites={showBombsitesOverlay}
                    showCallouts={showCalloutsOverlay}
                    showMapMods={showMapModsOverlay}
                    surfaces={{visible:true,assignments:surfaceAssignments,interactive:isDefenseSide && !isDrawingMode && pendingGadgetSlotIndex === null,review:isDefenseSide && reviewSurfaces,selectedId:selectedSurface?.id,onSelect:setSelectedSurface}}
                  />
                ) : null}
                <svg
                  aria-hidden="true"
                  className="drawing-layer"
                  focusable="false"
                  viewBox="0 0 100 56.25"
                  preserveAspectRatio="none"
                >
                  <defs>
                    {visibleDrawingStrokes.map((stroke, strokeIndex) =>
                      stroke.isEraser ? null : (
                        <mask id={`drawing-eraser-mask-${stroke.id}`} key={`mask-${stroke.id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="56.25">
                          <rect fill="white" height="56.25" width="100" x="0" y="0" />
                          {visibleDrawingStrokes.slice(strokeIndex + 1).filter((eraserStroke) => eraserStroke.isEraser).map((eraserStroke) => (
                            <polyline
                              fill="none"
                              key={`${stroke.id}-${eraserStroke.id}-eraser`}
                              points={eraserStroke.points.map(projectEditorPoint).map((point) => `${point.x},${point.y*9/16}`).join(" ")}
                              stroke="black"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={eraserStroke.width / 8}
                            />
                          ))}
                        </mask>
                      ),
                    )}
                  </defs>
                  {visibleDrawingStrokes.map((stroke) =>
                    stroke.isEraser ? null : (
                      <polyline
                        fill="none"
                        key={stroke.id}
                        mask={`url(#drawing-eraser-mask-${stroke.id})`}
                        points={stroke.points.map(projectEditorPoint).map((point) => `${point.x},${point.y*9/16}`).join(" ")}
                        stroke={stroke.color}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={stroke.width / 12}
                      />
                    ),
                  )}
                </svg>
                {slots.map((slot, index) => {
                  const markerOperator = slot.operators[0]
                    ? getOperator(slot.operators[0])
                    : null;
                  const isOffFloorSlotMarker = Boolean(slot.marker?.layoutId && slot.marker.layoutId !== activeLayoutId);

                  return slot.marker ? (
                    <span
                      aria-label={`Move Slot ${index + 1} marker`}
                      className={`position-marker marker-${index + 1}${markerOperator ? " has-operator" : ""}${isOffFloorSlotMarker ? " is-off-floor" : ""}`}
                      key={`slot-marker-${index}`}
                      onPointerCancel={endSlotMarkerDrag}
                      onPointerDown={(event) => startSlotMarkerDrag(event, index)}
                      onPointerLostCapture={endSlotMarkerDrag}
                      onPointerMove={moveSlotMarkerDrag}
                      onPointerUp={endSlotMarkerDrag}
                      role="button"
                      style={{
                        left: `${projectEditorPoint(slot.marker).x}%`,
                        top: `${projectEditorPoint(slot.marker).y}%`,
                        transform: `scale(${markerScale})`,
                      }}
                      tabIndex={0}
                      title={markerOperator ? `Slot ${index + 1}: ${markerOperator.name}` : `Slot ${index + 1}`}
                    >
                      {markerOperator ? (
                        <OperatorIcon alt={`${markerOperator.name} marker`} operator={markerOperator} size={28} detailed />
                      ) : (
                        index + 1
                      )}
                    </span>
                  ) : null;
                })}
                {slots.flatMap((slot, slotIndex) =>
                  slot.gadgets.map((gadget, gadgetIndex) => {
                    const isOffFloorGadgetMarker = gadget.layoutId !== activeLayoutId;
                    const isActiveGadgetMarker = activeSlotGadgetMarkerId === gadget.id;
                    const playerGadget = getPlayerGadgetTool(gadget.type);
                    const gadgetOperator = slot.operators[0] ? getOperator(slot.operators[0]) : null;
                    const placementLabel = getSlotPlacementLabel(gadget.type, gadgetIndex, gadgetOperator?.abilityName);
                    const gadgetIcon = playerGadget ? undefined : gadgetOperator?.gadgetIcon;

                    return (
                      <span
                        aria-label={`Select Slot ${slotIndex + 1} ${placementLabel}`}
                        className={`slot-gadget-marker marker-${slotIndex + 1}${playerGadget ? " has-player-gadget" : ""}${gadgetIcon ? " has-ability-icon" : ""}${isActiveGadgetMarker ? " active" : ""}${isOffFloorGadgetMarker ? " is-off-floor" : ""}`}
                        key={gadget.id}
                        onClick={(event) => selectSlotGadgetMarker(event, slotIndex, gadget.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            selectSlotGadgetMarker(event, slotIndex, gadget.id);
                          }
                        }}
                        onPointerCancel={endSlotGadgetDrag}
                        onPointerDown={(event) => startSlotGadgetDrag(event, slotIndex, gadget.id)}
                        onPointerMove={moveSlotGadgetDrag}
                        onPointerUp={endSlotGadgetDrag}
                        role="button"
                        style={{
                          "--slot-marker-color": slotDrawingColors[slotIndex]?.value ?? "#22e6c2",
                          left: `${projectEditorPoint(gadget).x}%`,
                          top: `${projectEditorPoint(gadget).y}%`,
                          transform: `scale(${gadget.size * mapMarkerScale * (playerGadget ? getMapModificationIconScale(playerGadget.type) : getAbilityIconScale(mapZoom))})`,
                        } as CSSProperties}
                        tabIndex={0}
                        title={`Slot ${slotIndex + 1}: ${placementLabel}`}
                      >
                        {playerGadget ? <MapModificationIcon className="mod-layout-icon" sprite={playerGadget.sprite} rotation={gadget.rotation} /> : null}
                        {gadgetIcon ? (
                          <img alt="" className="slot-gadget-ability-icon" draggable={false} src={gadgetIcon} />
                        ) : null}
                      </span>
                    );
                  }),
                )}
                {isDefenseSide && visibleMapModificationMarkers.map((marker, index) => {
                  const modificationSprite = getModificationSprite(marker.type);
                  const isActiveMapModification = activeMapModificationMarkerId === marker.id;
                  const isOffFloorMapModification = marker.layoutId !== activeLayoutId;

                  return (
                    <span
                      aria-label={`Select ${getModificationLabel(marker.type)} ${index + 1}`}
                      className={`map-modification-marker mod-${marker.type} has-icon${isActiveMapModification ? " active" : ""}${isOffFloorMapModification ? " is-off-floor" : ""}`}
                      key={marker.id}
                      onClick={(event) => selectMapModificationMarker(event, marker.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          selectMapModificationMarker(event, marker.id);
                        }
                      }}
                      onPointerCancel={endMapModificationDrag}
                      onPointerDown={(event) => startMapModificationDrag(event, marker.id)}
                      onPointerMove={moveMapModificationDrag}
                      onPointerUp={endMapModificationDrag}
                      role="button"
                      style={{
                        left: `${projectEditorPoint(marker).x}%`,
                        top: `${projectEditorPoint(marker).y}%`,
                        transform: `scale(${marker.size * mapMarkerScale * getMapModificationIconScale(marker.type)})`,
                      }}
                      tabIndex={0}
                      title={`${getModificationLabel(marker.type)} ${index + 1}`}
                    >
                      {modificationSprite ? (
                        <MapModificationIcon
                          className="mod-layout-icon"
                          rotation={marker.rotation}
                          sprite={modificationSprite}
                        />
                      ) : null}
                    </span>
                  );
                })}
              </span>
            </span>
            <div
              aria-label="Map overlay controls"
              className="map-overlay-toggles"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
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
            <button
              aria-expanded={isDrawingMode}
              aria-label="Toggle drawing mode"
              className={isDrawingMode ? "drawing-toggle active" : "drawing-toggle"}
              onClick={(event) => {
                event.stopPropagation();
                setIsDrawingMode((current) => !current);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
            >
              &#9998;
            </button>
            {isDrawingMode ? (
              <div
                className="drawing-panel"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div className="drawing-actions">
                  <button
                    aria-label="Undo last drawing stroke"
                    className="undo-drawing"
                    disabled={visibleDrawingStrokes.length === 0}
                    onClick={undoDrawingStroke}
                    type="button"
                  >
                    &#8630;
                  </button>
                  <button
                    aria-label="Toggle eraser"
                    aria-pressed={isEraserMode}
                    className={isEraserMode ? "active" : ""}
                    onClick={() => setIsEraserMode((current) => !current)}
                    title="Eraser"
                    type="button"
                  >
                    <img alt="" height={18} src="/icons/eraser-streamline-solar.svg" width={18} />
                  </button>
                </div>
                <label>
                  <span>Stroke</span>
                  <input
                    aria-label="Drawing stroke width"
                    max={22}
                    min={1}
                    onChange={(event) => setDrawingWidth(Number(event.target.value))}
                    type="range"
                    value={drawingWidth}
                  />
                </label>
                <div className="drawing-color-section">
                  <div className="drawing-colors" aria-label="Drawing colors">
                    {drawingColors.map((color) => (
                      <button
                        aria-label={`Use ${color.label}`}
                        className={!isEraserMode && drawingColor === color.value ? "active" : ""}
                        key={`${color.label}-${color.value}`}
                        onClick={() => {
                          setDrawingColor(color.value);
                          setIsEraserMode(false);
                        }}
                        style={{ background: color.value }}
                        type="button"
                      />
                    ))}
                  </div>
                  <div className="drawing-slot-colors" aria-label="Slot drawing colors">
                    {visibleSlotDrawingColors.map((color) => (
                      <button
                        aria-label={`Use ${color.label} color`}
                        className={!isEraserMode && drawingColor === color.value ? "active" : ""}
                        key={`${color.label}-${color.value}`}
                        onClick={() => {
                          setDrawingColor(color.value);
                          setIsEraserMode(false);
                        }}
                        style={{ background: color.value }}
                        type="button"
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="slot-editor">
          <div className="editor-panel-tabs slots-only">
            <div className="slot-tabs" aria-label="Player slots">
              {slots.map((slot, index) => (
                <div className="slot-tab-item" key={index}>
                  <button
                    className={editorPanel === "slots" && index === activeSlot ? "slot-tab-button active" : "slot-tab-button"}
                    onClick={() => {
                      setActiveSlot(index);
                      setPendingGadgetSlotIndex(null);
                      setEditorPanel("slots");
                    }}
                    type="button"
                  >
                    Slot {index + 1}
                    <small>{slot.marker ? "marked" : "open"}</small>
                  </button>
                  {slotHasChanges(slot) ? (
                    <button
                      aria-label={`Reset Slot ${index + 1}`}
                      className="reset-slot"
                      onClick={(event) => {
                        event.stopPropagation();
                        resetSlot(index);
                      }}
                      title={`Reset Slot ${index + 1}`}
                      type="button"
                    >
                      X
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {editorPanel === "map-modifications" && isDefenseSide ? (
            <div className="slot-form map-modifications-panel">
              <div className="mod-tool-grid" aria-label="Map modification tools">
                {modificationToolGrid.map((tool, index) =>
                  tool ? (
                    <button
                      className={
                        activeModificationType === tool.type ? "mod-tool active" : "mod-tool"
                      }
                      draggable
                      key={tool.type}
                      onClick={() => setActiveModificationType(tool.type)}
                      onDragStart={(event) => dragModification(event, tool.type)}
                      type="button"
                    >
                      <MapModificationIcon className="mod-tool-icon" sprite={tool.sprite} />
                      {tool.label}
                    </button>
                  ) : (
                    <span aria-hidden="true" className="mod-tool-spacer" key={`spacer-${index}`} />
                  ),
                )}
              </div>
              <div className="mod-marker-list" aria-label="Placed map modifications">
                {visibleMapModificationMarkers.length > 0 ? (
                  visibleMapModificationMarkers.map((marker, index) => {
                    const modificationSprite = getModificationSprite(marker.type);
                    const isActiveMapModification = activeMapModificationMarkerId === marker.id;
                    const isOffFloorMapModification = marker.layoutId !== activeLayoutId;
                    const markerTypeIndex = visibleMapModificationMarkers
                      .slice(0, index + 1)
                      .filter((item) => item.type === marker.type).length;

                    return (
                      <div
                        aria-label={`${getModificationLabel(marker.type)} ${markerTypeIndex}`}
                        aria-current={isActiveMapModification ? "true" : undefined}
                        className={`mod-marker-item${isActiveMapModification ? " active" : ""}${isOffFloorMapModification ? " is-off-floor" : ""}`}
                        key={marker.id}
                        onClick={() => setActiveMapModificationMarkerId(marker.id)}
                        ref={(element) => {
                          mapModificationListItems.current[marker.id] = element;
                        }}
                        title={`${getModificationLabel(marker.type)} ${markerTypeIndex}`}
                      >
                        {modificationSprite ? (
                          <MapModificationIcon
                            className="mod-list-icon"
                            rotation={marker.rotation}
                            sprite={modificationSprite}
                          />
                        ) : null}
                        <span className="mod-marker-count">{markerTypeIndex}</span>
                        <button
                          aria-label={`Rotate ${getModificationLabel(marker.type)} 90 degrees`}
                          className="mod-marker-rotate"
                          onClick={() => rotateMapModificationMarker(marker.id, 90)}
                          type="button"
                        >
                          ↻ 90
                        </button>
                        <button
                          aria-label={`Rotate ${getModificationLabel(marker.type)} 45 degrees`}
                          className="mod-marker-rotate"
                          onClick={() => rotateMapModificationMarker(marker.id, 45)}
                          type="button"
                        >
                          ↻ 45
                        </button>
                        <button
                          aria-label={`Increase ${getModificationLabel(marker.type)} size`}
                          className="mod-marker-size"
                          onClick={() => resizeMapModificationMarker(marker.id, 1)}
                          type="button"
                        >
                          +
                        </button>
                        <button
                          aria-label={`Decrease ${getModificationLabel(marker.type)} size`}
                          className="mod-marker-size"
                          onClick={() => resizeMapModificationMarker(marker.id, -1)}
                          type="button"
                        >
                          -
                        </button>
                        <button
                          aria-label={`Remove ${getModificationLabel(marker.type)}`}
                          className="remove-map-mod"
                          onClick={() => removeMapModificationMarker(marker.id)}
                          type="button"
                        >
                          X
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <span>No map modifications placed yet</span>
                )}
              </div>
              <label>
                Map modifications
                <AutoGrowTextarea
                  value={mapModifications}
                  onChange={setMapModifications}
                  placeholder="Rotations, footholes, lines of sight, barricades..."
                />
              </label>
            </div>
          ) : slots[activeSlot] ? (
            <div className="slot-form">
              <span className="slot-form-title">Slot {activeSlot + 1}</span>
              <label>
                Role
                <input
                  placeholder="Set a role..."
                  value={slots[activeSlot].role}
                  onChange={(event) => updateSlot(activeSlot, { role: event.target.value })}
                />
              </label>
              <label>
                Operators
              </label>
              <div className="selected-operators" aria-label="Selected operators">
                {slots[activeSlot].operators.length > 0 ? (
                  slots[activeSlot].operators.map((slug) => {
                    const operator = getOperator(slug);
                    return operator ? (
                      <button
                        aria-label={`Remove ${operator.name}`}
                        className="selected-operator"
                        key={slug}
                        onClick={() => removeSelectedOperator(slug)}
                        title={`Remove ${operator.name}`}
                        type="button"
                      >
                        <OperatorIcon operator={operator} size={18} />
                        <span>{operator.name}</span>
                        <span aria-hidden="true" className="remove-operator">X</span>
                      </button>
                    ) : null;
                  })
                ) : (
                  <span className="empty-selection">No operator selected yet</span>
                )}
              </div>
              <div className="operator-picker" aria-label={`${side} operators`}>
                {sideOperators.map((operator) => {
                  const selected = slots[activeSlot].operators.includes(operator.slug);
                  const disabled = !selected && slots[activeSlot].operators.length >= 3;
                  return (
                    <button
                      className={selected ? "selected" : ""}
                      disabled={disabled}
                      key={operator.slug}
                      onClick={() => toggleOperator(operator.slug)}
                      title={operator.name}
                      type="button"
                    >
                      <OperatorIcon operator={operator} size={34} />
                      <span className="operator-name">{operator.name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="gadget-plan-head">
                <span>Plan</span>
                <div className="slot-placement-actions">
                <button
                  aria-label={`Add ${activeAbilityName ?? "ability"} to Slot ${activeSlot + 1}`}
                  className={pendingGadgetSlotIndex === activeSlot && !pendingPlayerGadgetType ? "active" : ""}
                  disabled={slots[activeSlot].gadgets.filter(gadget => !gadget.type).length >= maxSlotGadgets}
                  onClick={() => startSlotGadgetPlacement()}
                  title={`Add ${activeAbilityName ?? "ability"}`}
                  type="button"
                >
                  <span className="slot-ability-name">+ {activeAbilityName ?? "Ability"}</span>
                </button>
                {isDefenseSide ? <button
                  aria-label={`Add gadget to Slot ${activeSlot + 1}`}
                  aria-expanded={showPlayerGadgetMenu}
                  className={showPlayerGadgetMenu || (pendingGadgetSlotIndex === activeSlot && pendingPlayerGadgetType) ? "active" : ""}
                  disabled={slots[activeSlot].gadgets.filter(gadget => gadget.type).length >= maxSlotGadgets}
                  onClick={() => { setPendingGadgetSlotIndex(null); setShowPlayerGadgetMenu(current => !current); }}
                  title="Add gadget"
                  type="button"
                >+ Gadget</button> : null}
                </div>
              </div>
              {showPlayerGadgetMenu && isDefenseSide ? <div className="player-gadget-picker" aria-label="Player gadgets">
                {playerGadgetTools.map(tool => <button key={tool.type} type="button" onClick={() => startSlotGadgetPlacement(tool.type)}>
                  <MapModificationIcon className="mod-tool-icon" sprite={tool.sprite} />{tool.label}
                </button>)}
              </div> : null}
              {pendingGadgetSlotIndex === activeSlot ? <span className="slot-placement-hint">Click the map to place {pendingPlayerGadgetType ? getPlayerGadgetTool(pendingPlayerGadgetType)?.label : activeAbilityName ?? "an ability"}.</span> : null}
              <div className="slot-gadget-list" aria-label={`Slot ${activeSlot + 1} placed abilities and gadgets`}>
                <span className="slot-equipment-order-status" role="status">{equipmentOrderStatus}</span>
                {slots[activeSlot].gadgets.length > 0 ? (
                  slots[activeSlot].gadgets.map((gadget, index) => {
                    const isActiveGadget = activeSlotGadgetMarkerId === gadget.id;
                    const isOffFloorGadget = gadget.layoutId !== activeLayoutId;
                    const isExpandedGadget = expandedSlotGadgetMarkerId === gadget.id;
                    const placementLabel = getSlotPlacementLabel(gadget.type, index, activeAbilityName);
                    const playerGadget = getPlayerGadgetTool(gadget.type);

                    return (
                      <div
                        className={`slot-gadget-item${isActiveGadget ? " active" : ""}${isOffFloorGadget ? " is-off-floor" : ""}${isExpandedGadget ? " expanded" : ""}${slotGadgetDropTargetId === gadget.id ? " is-drop-target" : ""}`}
                        key={gadget.id}
                        title={`Select ${placementLabel}`}
                        data-equipment-id={gadget.id}
                      >
                        <button
                          type="button"
                          className="slot-gadget-grip"
                          aria-label={`Reorder ${placementLabel}`}
                          title="Drag to reorder. Use Arrow Up or Arrow Down with the keyboard."
                          onPointerDown={event => {
                            if (event.button !== 0) return;
                            event.preventDefault();
                            event.stopPropagation();
                            slotEquipmentDrag.current = { id: gadget.id, slotIndex: activeSlot, phaseId: activePhaseId };
                            event.currentTarget.setPointerCapture(event.pointerId);
                          }}
                          onPointerMove={event => {
                            const source = slotEquipmentDrag.current;
                            if (!source || source.slotIndex !== activeSlot || source.phaseId !== activePhaseId) return;
                            const list = event.currentTarget.closest(".slot-gadget-list");
                            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-equipment-id]");
                            const targetId = target && list?.contains(target) ? target.getAttribute("data-equipment-id") : null;
                            source.targetId = targetId && targetId !== source.id ? targetId : undefined;
                            setSlotGadgetDropTargetId(source.targetId ?? null);
                            const scrollPanel = event.currentTarget.closest(".slot-editor");
                            if (scrollPanel) {
                              const rect = scrollPanel.getBoundingClientRect();
                              if (event.clientY > rect.bottom - 32) scrollPanel.scrollTop += 12;
                              else if (event.clientY < rect.top + 32) scrollPanel.scrollTop -= 12;
                            }
                          }}
                          onPointerUp={event => {
                            const source = slotEquipmentDrag.current;
                            if (source?.targetId && source.slotIndex === activeSlot && source.phaseId === activePhaseId) reorderSlotGadget(source.id, source.targetId);
                            slotEquipmentDrag.current = null;
                            setSlotGadgetDropTargetId(null);
                            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                          }}
                          onPointerCancel={() => { slotEquipmentDrag.current = null; setSlotGadgetDropTargetId(null); }}
                          onLostPointerCapture={() => { slotEquipmentDrag.current = null; setSlotGadgetDropTargetId(null); }}
                          onKeyDown={event => {
                            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                            event.preventDefault();
                            const target = slots[activeSlot].gadgets[index + (event.key === "ArrowUp" ? -1 : 1)];
                            if (target) reorderSlotGadget(gadget.id, target.id);
                          }}
                        >
                          <svg aria-hidden="true" width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="4" cy="4" r="1" /><circle cx="8" cy="4" r="1" /><circle cx="4" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="8" cy="12" r="1" /></svg>
                        </button>
                        <button
                          className="slot-gadget-summary"
                          onClick={() => {
                            setActiveSlotGadgetMarkerId(gadget.id);
                            setPendingGadgetSlotIndex(null);
                          }}
                          type="button"
                        >
                          {playerGadget ? <MapModificationIcon className="mod-tool-icon" sprite={playerGadget.sprite} /> : <span
                            aria-hidden="true"
                            className="slot-gadget-dot"
                            style={{ "--slot-marker-color": slotDrawingColors[activeSlot]?.value ?? "#22e6c2" } as CSSProperties}
                          />}
                          <span className="slot-gadget-title">
                            <strong>{placementLabel}</strong>
                            <small>{playerGadget ? "Gadget" : activeAbilityName ?? "Ability"} · {selectedMap.layouts.find(layout => layout.id === gadget.layoutId)?.label ?? "Other floor"}</small>
                          </span>
                        </button>
                        <button
                          aria-label={`${isExpandedGadget ? "Collapse" : "Expand"} ${placementLabel}`}
                          aria-expanded={isExpandedGadget}
                          className={isExpandedGadget ? "slot-gadget-expand open" : "slot-gadget-expand"}
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveSlotGadgetMarkerId(gadget.id);
                            setPendingGadgetSlotIndex(null);
                            setExpandedSlotGadgetMarkerId((current) => (current === gadget.id ? null : gadget.id));
                          }}
                          type="button"
                        >
                          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 5 7 7-7 7" /></svg>
                        </button>
                        <button
                          aria-label={`Remove ${placementLabel}`}
                          className="slot-gadget-remove"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeSlotGadgetMarker(activeSlot, gadget.id);
                          }}
                          title={`Remove ${placementLabel}`}
                          type="button"
                        >
                          ×
                        </button>
                        {isExpandedGadget ? (
                          <div className="slot-gadget-fields">
                            {playerGadget ? <div className="slot-gadget-transform">
                            {playerGadget ? <div className="slot-gadget-size-controls" aria-label={`${placementLabel} rotation controls`}>
                              <span>Rotate</span>
                              {[90, 45].map(degrees => <button key={degrees} type="button" aria-label={`Rotate ${placementLabel} clockwise ${degrees} degrees`} onClick={() => updateSlotGadgetMarker(activeSlot, gadget.id, { rotation: ((gadget.rotation ?? 0) + degrees) % 360 })}><svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 9a8 8 0 1 0 0 6M20 3v6h-6" /></svg>{degrees}°</button>)}
                            </div> : null}
                            <div className="slot-gadget-size-controls" aria-label={`${placementLabel} size controls`}>
                              <span>Size</span>
                              <button
                                aria-label={`Increase ${placementLabel} size`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  resizeSlotGadgetMarker(activeSlot, gadget.id, 1);
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                type="button"
                              >
                                +
                              </button>
                              <button
                                aria-label={`Decrease ${placementLabel} size`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  resizeSlotGadgetMarker(activeSlot, gadget.id, -1);
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                type="button"
                              >
                                -
                              </button>
                            </div>
                            </div> : null}
                            <div className="slot-gadget-image-fields">
                            <span className="slot-gadget-field-label">Reference images <small>Optional</small></span>
                            {Array.from({ length: Math.min(3, Math.max(1, gadget.imageUrls.filter((url) => url.trim()).length + 1)) }).map((_, imageIndex) => (
                              <input
                                aria-label={`${placementLabel} image URL ${imageIndex + 1}`}
                                key={`gadget-${gadget.id}-image-${imageIndex}`}
                                onChange={(event) =>
                                  updateSlotGadgetImageUrl(activeSlot, gadget.id, imageIndex, event.target.value)
                                }
                                onClick={(event) => event.stopPropagation()}
                                onPointerDown={(event) => event.stopPropagation()}
                                placeholder={`PNG image URL ${imageIndex + 1}...`}
                                type="url"
                                value={gadget.imageUrls[imageIndex] ?? ""}
                              />
                            ))}
                            </div>
                            <label className="slot-gadget-description-field">
                            <span className="slot-gadget-field-label">Description</span>
                            <textarea
                              aria-label={`${placementLabel} description`}
                              onChange={(event) =>
                                updateSlotGadgetMarker(activeSlot, gadget.id, { description: event.target.value })
                              }
                              onClick={(event) => event.stopPropagation()}
                              onPointerDown={(event) => event.stopPropagation()}
                              placeholder="Describe this ability or gadget..."
                              rows={2}
                              value={gadget.description}
                            />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <span className="empty-selection">No abilities or gadgets placed yet</span>
                )}
              </div>
              <label>
                Notes
                <AutoGrowTextarea
                  value={slots[activeSlot].notes}
                  onChange={(value) => updateSlot(activeSlot, { notes: value })}
                  placeholder="Overall function of this player..."
                />
              </label>
            </div>
          ) : null}
        </aside>

        <div className="json-quick-actions">
          <span aria-live="polite">{jsonStatus}</span>
          <button className="json-load-button" onClick={() => setIsJsonLoadOpen(true)} type="button">
            Load
          </button>
          <button className="json-copy-button" onClick={() => requestNamedJsonAction("save")} type="button">
            Copy
          </button>
          <button className="json-save-button" onClick={() => requestNamedJsonAction("export")} type="button">
            Save
          </button>
        </div>
      </div>

      {pendingJsonAction ? (
        <div className="json-load-backdrop" role="presentation">
          <section aria-labelledby="strat-name-title" className="json-load-dialog strat-name-dialog" role="dialog" aria-modal="true">
            <header>
              <div>
                <span>Strat name</span>
                <h3 id="strat-name-title">Name this strat before {pendingJsonAction === "export" ? "exporting" : "saving"}</h3>
              </div>
              <button aria-label="Close strat name dialog" onClick={cancelStratNameDialog} type="button">
                X
              </button>
            </header>
            <p>This name is saved into the JSON and will be shown in View Strat.</p>
            <input
              autoFocus
              className="strat-name-input"
              onChange={(event) => setStratNameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  confirmStratNameDialog();
                }
                if (event.key === "Escape") {
                  cancelStratNameDialog();
                }
              }}
              placeholder="Strat name..."
              value={stratNameInput}
            />
            <div className="json-load-dialog-actions">
              <button onClick={cancelStratNameDialog} type="button">
                Cancel
              </button>
              <button onClick={confirmStratNameDialog} type="button">
                Continue
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isJsonLoadOpen ? (
        <div className="json-load-backdrop" role="presentation">
          <section aria-labelledby="json-load-title" className="json-load-dialog" role="dialog" aria-modal="true">
            <header>
              <div>
                <span>Load JSON</span>
                <h3 id="json-load-title">Continue editing a saved strat</h3>
              </div>
              <button aria-label="Close JSON load dialog" onClick={() => setIsJsonLoadOpen(false)} type="button">
                X
              </button>
            </header>
            <p>
              Paste a StratShare JSON export here to load its map, phases, slots, operators, drawings, gadgets, and
              map modifications back into the editor.
            </p>
            <textarea
              aria-label="Paste strat JSON to continue editing"
              onChange={(event) => setJsonImport(event.target.value)}
              placeholder="Paste strat JSON here..."
              spellCheck={false}
              value={jsonImport}
            />
            <div className="json-load-dialog-actions">
              <button onClick={() => setIsJsonLoadOpen(false)} type="button">
                Cancel
              </button>
              <button onClick={importStratJson} type="button">
                Load JSON
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingMap ? (
        <div className="map-change-backdrop" role="presentation">
          <section
            aria-labelledby="map-change-title"
            aria-modal="true"
            className="map-change-dialog"
            role="dialog"
          >
            <span className="dialog-kicker">Reset current strat</span>
            <h3 id="map-change-title">Change map to {pendingMap.name}?</h3>
            <p>
              Changing the map will clear selected operators, roles, ability plans, gadgets,
              player count, zoom, and all marked positions.
            </p>
            <div className="dialog-actions">
              <button className="ghost-action" onClick={() => setPendingMapSlug(null)} type="button">
                Keep current map
              </button>
              <button className="danger-action" onClick={() => applyMapChange(pendingMap.slug)} type="button">
                Change map
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingSide ? (
        <div className="map-change-backdrop" role="presentation">
          <section
            aria-labelledby="side-change-title"
            aria-modal="true"
            className="map-change-dialog"
            role="dialog"
          >
            <span className="dialog-kicker">Switch side</span>
            <h3 id="side-change-title">Change side to {pendingSide}?</h3>
            <p>
              Switching sides will clear selected operators, ability plans, and gadgets for
              every slot. Roles and marked positions will stay in place.
            </p>
            <div className="dialog-actions">
              <button className="ghost-action" onClick={() => setPendingSide(null)} type="button">
                Keep current side
              </button>
              <button className="danger-action" onClick={() => applySideChange(pendingSide)} type="button">
                Change side
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
