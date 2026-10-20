import registry from "./map-surfaces.generated.json" with { type: "json" };
import type { MapLayout } from "./map-data";

export type SurfaceKind = "wall" | "hatch";
export type SurfaceAction = "reinforcement" | "headholes" | "footholes" | "topholes" | "whole-wall" | "standing-rotation" | "crouching-rotation" | "vault-rotation" | "popped-hatch";
export type MapSurface = {
  id: string;
  sourceId: string;
  kind: SurfaceKind;
  points: { x: number; y: number }[];
  needsReview: boolean;
  legacySurfaceId?: string;
  assignmentLayoutId?: string;
  assignmentSurfaceId?: string;
  hatchDirection?: "above" | "below";
  connectedFloorLabel?: string;
};
export type SurfacePosition = "left" | "middle" | "right";
export type SurfaceAssignment = { surfaceId: string; layoutId: string; action: SurfaceAction; position?: SurfacePosition };
export type SurfaceLayout = { source: string; viewBox: string; features: MapSurface[] };
const layouts = registry.layouts as Record<string, SurfaceLayout>;

export const surfaceActions: { action: SurfaceAction; label: string; short: string; mapText: string; color: string; icon?: string }[] = [
  { action: "reinforcement", label: "Reinforcement", short: "R", mapText: "", color: "#a65f4d", icon: "/icons/wall-menu/reinforcement-main.png" },
  { action: "headholes", label: "Headholes", short: "HH", mapText: "Head", color: "#42f47b", icon: "/icons/wall-menu/head.png" },
  { action: "footholes", label: "Footholes", short: "FH", mapText: "Foot", color: "#42f47b", icon: "/icons/wall-menu/foot.png" },
  { action: "topholes", label: "Top Holes", short: "TH", mapText: "Top", color: "#42f47b", icon: "/icons/wall-menu/top.png" },
  { action: "whole-wall", label: "Whole Wall", short: "WW", mapText: "Whole", color: "#42f47b", icon: "/icons/wall-menu/whole.png" },
  { action: "standing-rotation", label: "Vault Rotation", short: "VR", mapText: "Vault", color: "#3aa8ff", icon: "/icons/wall-menu/vault.png" },
  { action: "crouching-rotation", label: "Crouching rotation", short: "CR", mapText: "Crouching", color: "#3aa8ff", icon: "/icons/wall-menu/crouch.png" },
  { action: "vault-rotation", label: "Walk Rotation", short: "WR", mapText: "Walk", color: "#3aa8ff", icon: "/icons/wall-menu/walk.png" },
  { action: "popped-hatch", label: "Popped hatch", short: "PH", mapText: "", color: "#a875d6", icon: "/icons/wall-menu/popped-hatch.png" },
];

export function getSurfaceLayout(layoutId: string): SurfaceLayout | undefined {
  return layouts[layoutId];
}

// Both hatch representations share the original lower-floor assignment in saved JSON.
export function getDisplaySurfaceLayout(layoutId: string, mapLayouts: MapLayout[]): SurfaceLayout | undefined {
  const data = getSurfaceLayout(layoutId);
  if (!data) return undefined;
  const index = mapLayouts.findIndex(layout => layout.id === layoutId);
  const above = index >= 0 ? mapLayouts[index + 1] : undefined;
  const below = index > 0 ? mapLayouts[index - 1] : undefined;
  const lowerData = below ? getSurfaceLayout(below.id) : undefined;
  const features: MapSurface[] = data.features.map(surface => surface.kind === "hatch" && above
    ? {...surface,hatchDirection:"above",connectedFloorLabel:above.label}
    : surface);
  // Registered floors share the same SVG coordinate space within each map.
  if (below && lowerData?.viewBox === data.viewBox) {
    features.push(...lowerData.features.filter(surface => surface.kind === "hatch").map(surface => ({
      ...surface,id:`hatch-from:${below.id}:${surface.id}`,assignmentLayoutId:below.id,
      assignmentSurfaceId:surface.id,hatchDirection:"below" as const,connectedFloorLabel:below.label,
    })));
  }
  return {...data,features};
}

export function getSurfaceAssignmentTarget(layoutId: string, surface: MapSurface) {
  return {layoutId:surface.assignmentLayoutId ?? layoutId,surfaceId:surface.assignmentSurfaceId ?? surface.id};
}

export function findSurfaceAssignment(assignments: SurfaceAssignment[], layoutId: string, surface: MapSurface) {
  const target = getSurfaceAssignmentTarget(layoutId,surface);
  return assignments.find(item => item.layoutId === target.layoutId && item.surfaceId === target.surfaceId);
}

export function getSurfaceActions(kind: SurfaceKind) {
  return surfaceActions.filter(option => kind === "hatch"
    ? option.action === "reinforcement" || option.action === "popped-hatch"
    : option.action !== "popped-hatch");
}

export function parseSurfaceAssignments(value: unknown, layoutIds: string[]): SurfaceAssignment[] {
  if (!Array.isArray(value)) return [];
  const valid = new Map<string, SurfaceAssignment>();
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.surfaceId !== "string" || !layoutIds.includes(item.layoutId)) continue;
    const features = getSurfaceLayout(item.layoutId)?.features.filter(f => f.id === item.surfaceId || f.legacySurfaceId === item.surfaceId) ?? [];
    for (const feature of features) {
      if (!getSurfaceActions(feature.kind).some(option => option.action === item.action)) continue;
      const position: SurfaceAssignment["position"] = item.action !== "whole-wall" && (item.position === "left" || item.position === "middle" || item.position === "right") ? item.position : undefined;
      valid.set(`${item.layoutId}/${feature.id}`, {surfaceId:feature.id,layoutId:item.layoutId,action:item.action,...(position ? {position} : {})});
    }
  }
  return [...valid.values()];
}

export function setSurfaceAssignment(current: SurfaceAssignment[], layoutId: string, surfaceId: string, action: SurfaceAction | null, position?: SurfaceAssignment["position"]) {
  const next = current.filter(item => item.layoutId !== layoutId || item.surfaceId !== surfaceId);
  return action ? parseSurfaceAssignments([...next,{layoutId,surfaceId,action,...(position ? {position} : {})}], [...new Set([...current.map(item=>item.layoutId),layoutId])]) : next;
}

export function countReinforcedSurfaces(assignments: SurfaceAssignment[]) {
  const canonical = parseSurfaceAssignments(assignments,[...new Set(assignments.map(item=>item.layoutId))]);
  return canonical.filter(item=>item.action === "reinforcement").length;
}
