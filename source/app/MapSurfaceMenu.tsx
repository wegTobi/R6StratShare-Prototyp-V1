"use client";

import { useEffect, useRef, useState } from "react";
import { getSurfaceActions } from "./map-surfaces";
import type { MapSurface, SurfaceAction, SurfacePosition } from "./map-surfaces";

type WallMenuView = "root" | "holes" | "rotation" | "position";
type WallMenuOption = { action: SurfaceAction; label: string; short: string; icon?: string };

const wallHoleOptions: WallMenuOption[] = [
  { action: "whole-wall", label: "Whole Wall", short: "WW", icon: "/icons/wall-menu/whole.png" },
  { action: "topholes", label: "Top Holes", short: "TH", icon: "/icons/wall-menu/top.png" },
  { action: "headholes", label: "Head Holes", short: "HH", icon: "/icons/wall-menu/head.png" },
  { action: "footholes", label: "Foot Holes", short: "FH", icon: "/icons/wall-menu/foot.png" },
];

const wallRotationOptions: WallMenuOption[] = [
  { action: "standing-rotation", label: "Vault Rotation", short: "VR", icon: "/icons/wall-menu/vault.png" },
  { action: "crouching-rotation", label: "Crouching Rotation", short: "CR", icon: "/icons/wall-menu/crouch.png" },
  { action: "vault-rotation", label: "Walk Rotation", short: "WR", icon: "/icons/wall-menu/walk.png" },
];

const wallHoleActions = new Set<SurfaceAction>(wallHoleOptions.map(option => option.action));
const wallRotationActions = new Set<SurfaceAction>(wallRotationOptions.map(option => option.action));

export function MapSurfaceMenu({surface,number,action,position,advancedMode = false,onChange,onClose}: {surface:MapSurface;number:number;action?:SurfaceAction;position?:SurfacePosition;advancedMode?:boolean;onChange:(action:SurfaceAction|null,position?:SurfacePosition)=>void;onClose:()=>void}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [wallMenuView, setWallMenuView] = useState<WallMenuView>("root");
  const [pendingAction, setPendingAction] = useState<SurfaceAction | null>(null);

  useEffect(() => {
    const previous = document.activeElement;
    setWallMenuView("root");
    setPendingAction(null);
    return () => {
      if ((previous instanceof HTMLElement || previous instanceof SVGElement) && previous.isConnected) {
        previous.focus({preventScroll:true});
      }
    };
  }, [surface.id]);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>("[data-surface-menu-autofocus]")?.focus({preventScroll:true});
  }, [surface.id, wallMenuView]);

  const surfaceLabel = surface.kind === "wall" ? "Wall" : "Hatch";
  const submenuOptions = wallMenuView === "holes" ? wallHoleOptions : wallRotationOptions;
  const menuTitle = wallMenuView === "root" ? "Plan surface" : wallMenuView === "holes" ? "Holes" : wallMenuView === "position" ? "Position" : "Rotation";

  function selectAction(selected: SurfaceAction) {
    if (advancedMode && surface.kind === "wall" && selected !== "whole-wall" && (wallHoleActions.has(selected) || wallRotationActions.has(selected))) {
      setPendingAction(selected);
      setWallMenuView("position");
    } else onChange(selected);
  }

  function renderActionOption(option: WallMenuOption, autofocus = false) {
    return (
      <button data-surface-menu-autofocus={autofocus ? "" : undefined} className="surface-plan-option" type="button" key={option.action} aria-pressed={action===option.action} onClick={()=>selectAction(option.action)}>
        <span className="surface-plan-option-icon" aria-hidden="true">{option.icon ? <span className="surface-plan-custom-icon" style={{maskImage:`url("${option.icon}")`,transform:wallRotationActions.has(option.action) ? `scale(${option.action === "standing-rotation" ? 1.22 : 1.3225})` : undefined}} /> : option.short}</span>
        <span>{option.label}</span>
      </button>
    );
  }

  return (
    <section ref={dialogRef} role="dialog" aria-label={`${surfaceLabel} ${number} plan`} className="surface-plan-menu" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==="Escape"){event.preventDefault();onClose();}}}>
      <div className="surface-plan-heading">
        <div className="surface-plan-heading-main">
          {surface.kind === "wall" && wallMenuView !== "root" ? (
            <button className="surface-plan-back" type="button" aria-label="Back to wall options" onClick={()=>{setWallMenuView(wallMenuView === "position" && pendingAction ? wallHoleActions.has(pendingAction) ? "holes" : "rotation" : "root");setPendingAction(null);}}>←</button>
          ) : null}
          <span className="surface-plan-heading-copy">
            <small>{surfaceLabel} {number}</small>
            <strong>{surface.kind === "wall" ? menuTitle : "Plan surface"}</strong>
          </span>
        </div>
        <button className="surface-plan-close" type="button" onClick={onClose} aria-label="Close surface plan">×</button>
      </div>
      {surface.needsReview ? <p className="surface-review-note">Check segmentation: this area may contain more than one wall panel. Report its number and floor before planning individual panels.</p> : null}
      {surface.kind === "wall" && wallMenuView === "position" && pendingAction ? (
        <div className="surface-plan-options is-position">
          <button className="surface-plan-option surface-plan-no-position" type="button" aria-label="Apply without position" title="Apply without position" onClick={()=>onChange(pendingAction)}>
            <span>None</span>
          </button>
          {(["left","middle","right"] as const).map((choice,index)=>(
            <button key={choice} data-surface-menu-autofocus={index === 0 ? "" : undefined} className={`surface-plan-option${choice !== "middle" ? " surface-plan-position-arrow" : ""}`} type="button" aria-label={choice === "left" ? "Left" : choice === "middle" ? "Middle" : "Right"} aria-pressed={action === pendingAction && position === choice} onClick={()=>onChange(pendingAction,choice)}>
              {choice === "left" ? "←" : choice === "middle" ? "Middle" : "→"}
            </button>
          ))}
        </div>
      ) : surface.kind === "wall" && wallMenuView === "root" ? (
        <div className="surface-plan-options is-root">
          <button data-surface-menu-autofocus className="surface-plan-option" type="button" aria-pressed={action==="reinforcement"} onClick={()=>onChange("reinforcement")}>
            <span className="surface-plan-option-icon" aria-hidden="true"><span className="surface-plan-custom-icon" style={{maskImage:'url("/icons/wall-menu/reinforcement-main.png")'}} /></span>
            <span>Reinforcement</span>
          </button>
          <button className="surface-plan-option" type="button" aria-pressed={Boolean(action && wallHoleActions.has(action))} aria-label="Open holes options" onClick={()=>setWallMenuView("holes")}>
            <span className="surface-plan-option-icon" aria-hidden="true"><span className="surface-plan-custom-icon" style={{maskImage:'url("/icons/wall-menu/holes-main.png")'}} /></span>
            <span>Holes</span>
            <span className="surface-plan-option-arrow" aria-hidden="true">›</span>
          </button>
          <button className="surface-plan-option" type="button" aria-pressed={Boolean(action && wallRotationActions.has(action))} aria-label="Open rotation options" onClick={()=>setWallMenuView("rotation")}>
            <span className="surface-plan-option-icon" aria-hidden="true"><span className="surface-plan-custom-icon" style={{maskImage:'url("/icons/wall-menu/rotation-main.png")'}} /></span>
            <span>Rotation</span>
            <span className="surface-plan-option-arrow" aria-hidden="true">›</span>
          </button>
          <button className="surface-plan-option is-unmodified" type="button" aria-pressed={!action} onClick={()=>onChange(null)}>
            <span className="surface-plan-option-icon" aria-hidden="true">—</span>
            <span>Unmodified</span>
          </button>
        </div>
      ) : surface.kind === "wall" ? (
        <div className="surface-plan-options is-submenu">
          {submenuOptions.map((option,index) => renderActionOption(option,index === 0))}
        </div>
      ) : (
        <div className="surface-plan-options is-submenu">
          {getSurfaceActions(surface.kind).map((option,index)=>renderActionOption(option,index === 0))}
          <button className="surface-plan-option is-unmodified" type="button" aria-pressed={!action} onClick={()=>onChange(null)}>
            <span className="surface-plan-option-icon" aria-hidden="true">—</span>
            <span>Unmodified</span>
          </button>
        </div>
      )}
    </section>
  );
}
