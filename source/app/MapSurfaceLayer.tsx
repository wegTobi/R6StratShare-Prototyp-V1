"use client";

import type { CSSProperties } from "react";
import { getDisplaySurfaceLayout, findSurfaceAssignment, surfaceActions } from "./map-surfaces";
import type { MapSurface, SurfaceAssignment } from "./map-surfaces";
import type { MapLayout } from "./map-data";

export type MapSurfaceLayerProps = {
  layoutId: string;
  mapLayouts?: MapLayout[];
  assignments?: SurfaceAssignment[];
  visible?: boolean;
  interactive?: boolean;
  review?: boolean;
  selectedId?: string;
  onSelect?: (surface: MapSurface) => void;
  style?: CSSProperties;
};

export function MapSurfaceLayer({layoutId,mapLayouts = [],assignments = [],visible = false,interactive = false,review = false,selectedId,onSelect,style}: MapSurfaceLayerProps) {
  const data = getDisplaySurfaceLayout(layoutId,mapLayouts);
  if (!data || (!visible && !interactive && !review && !data.features.some(surface=>findSurfaceAssignment(assignments,layoutId,surface)))) return null;
  return (
    <svg className="map-surface-layer" viewBox={data.viewBox} preserveAspectRatio="xMidYMid slice" style={style} role="group" aria-label="Wall and hatch plans">
      {data.features.map((surface,index) => {
        const assignment = findSurfaceAssignment(assignments,layoutId,surface);
        if (!visible && !interactive && !review && !assignment) return null;
        const option = surfaceActions.find(item=>item.action===assignment?.action);
        const selected = selectedId===surface.id;
        const baseColor = surface.hatchDirection === "above" ? "#ffe680" : surface.hatchDirection === "below" ? "#b38a00" : "#ffcc00";
        const points = surface.points.map(p=>`${p.x},${p.y}`).join(" ");
        const center = {x:surface.points.reduce((n,p)=>n+p.x,0)/4,y:surface.points.reduce((n,p)=>n+p.y,0)/4};
        const edges = [surface.points[1],surface.points[3]].map(point=>({x:point.x-surface.points[0].x,y:point.y-surface.points[0].y}));
        const lengths = edges.map(edge=>Math.hypot(edge.x,edge.y));
        const longEdge = edges[lengths[0] >= lengths[1] ? 0 : 1];
        const angle = Math.atan2(longEdge.y,longEdge.x)*180/Math.PI;
        const textAngle = angle > 90 ? angle-180 : angle < -90 ? angle+180 : angle;
        const positionLabel = surface.kind === "wall" && assignment?.action !== "whole-wall" && assignment?.position ? assignment.position === "left" ? "Left" : assignment.position === "middle" ? "Middle" : "Right" : "";
        const positionSymbol = positionLabel === "Left" ? "←" : positionLabel === "Right" ? "→" : positionLabel;
        const iconSize = Math.min(...lengths)*(surface.kind === "hatch" ? assignment?.action === "popped-hatch" ? 0.72 : 0.6 : assignment?.action === "reinforcement" ? 0.9 : 1.8);
        const gap = iconSize*0.2;
        const textSize = Math.min(Math.min(...lengths)*0.85,Math.max(0,Math.max(...lengths)*0.9-iconSize-gap)/Math.max(1,positionSymbol.length*0.65));
        const positionWidth = textSize*positionSymbol.length*0.65;
        const labelWidth = positionSymbol ? iconSize+gap+positionWidth : iconSize;
        const iconX = -labelWidth/2+(positionLabel === "Left" ? positionWidth+gap : 0);
        const positionX = positionLabel === "Left" ? -labelWidth/2 : iconX+iconSize+gap;
        const label = `${surface.kind === "wall" ? "Wall" : "Hatch"} ${index+1}${option ? `: ${option.label}${positionLabel ? ` ${positionLabel}` : ""}` : ": Unmodified"}${surface.hatchDirection ? `. Connects to ${surface.connectedFloorLabel} ${surface.hatchDirection}` : ""}${surface.needsReview ? ". Check segmentation" : ""}`;
        return (
          <g key={surface.id} data-surface-id={surface.id} data-hatch-direction={surface.hatchDirection}>
            <polygon className={`map-surface-shape${selected ? " selected" : ""}${review && surface.needsReview ? " needs-review" : ""}`} points={points} fill={option?.color ?? (visible ? baseColor : "transparent")} fillOpacity={option ? 0.65 : visible ? 0.24 : 0} stroke={selected ? "#ffffff" : option?.color ?? (review ? "#22e6c2" : visible ? baseColor : "transparent")} strokeOpacity={option || selected || review ? 1 : surface.kind === "wall" ? 0.55 : 0.35} strokeWidth={selected ? 2 : 1} vectorEffect="non-scaling-stroke" />
            {interactive ? (
              <polygon className="map-surface-hit" points={points} fill="transparent" stroke="transparent" strokeWidth="8" vectorEffect="non-scaling-stroke" role="button" tabIndex={0} aria-label={label} aria-haspopup="dialog" aria-pressed={selected} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();event.currentTarget.focus({preventScroll:true});onSelect?.(surface);}} onKeyDown={event=>{if(event.key==="Enter" || event.key===" "){event.preventDefault();event.stopPropagation();onSelect?.(surface);}}}>
                <title>{label}</title>
              </polygon>
            ) : <title>{label}</title>}
            {option?.icon && !review ? (
              <g aria-hidden="true" className="map-surface-plan-label" transform={`translate(${center.x} ${center.y}) rotate(${textAngle})`}>
                <image className={`map-surface-plan-icon${surface.kind === "hatch" ? " is-hatch" : ""}${assignment?.action === "reinforcement" ? " is-reinforcement" : ""}`} href={option.icon} x={iconX} y={-iconSize/2} width={iconSize} height={iconSize} preserveAspectRatio="xMidYMid meet" transform={surface.kind === "wall" ? `rotate(${-textAngle} ${iconX+iconSize/2} 0)` : undefined} />
                {positionSymbol ? <text className={`map-surface-number${positionLabel === "Left" || positionLabel === "Right" ? " map-surface-position-arrow" : ""}`} x={positionX} y={positionLabel === "Left" || positionLabel === "Right" ? -textSize*0.12 : 0} dominantBaseline="central" fontSize={textSize}>{positionSymbol}</text> : null}
              </g>
            ) : null}
            {review ? <text className="map-surface-number" x={center.x} y={center.y} textAnchor="middle" dominantBaseline="central" fontSize={Math.max(2,Math.min(Math.hypot(surface.points[1].x-surface.points[0].x,surface.points[1].y-surface.points[0].y),Math.hypot(surface.points[2].x-surface.points[1].x,surface.points[2].y-surface.points[1].y))*1.4)}>{index+1}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}
