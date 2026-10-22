import type { ReactNode, RefObject } from "react";

// Every attached layer shares this exact DOM rectangle and outer transform.
export function MapPlane({ zoom, planeRef, children }: { zoom: number; planeRef?: RefObject<HTMLSpanElement | null>; children: ReactNode }) {
  return <span ref={planeRef} className="layout-zoom-layer map-plane" data-coordinate-space="artwork-v2" style={{ transform: `scale(${zoom})` }}>{children}</span>;
}
