"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { MapLayout, TacticalMap } from "./map-data";
import { MapSurfaceLayer } from "./MapSurfaceLayer";
import type { MapSurfaceLayerProps } from "./MapSurfaceLayer";

type MapLayoutImageProps = {
  showBombsites?: boolean;
  showCallouts?: boolean;
  showMapMods?: boolean;
  layout: MapLayout;
  map: TacticalMap;
  surfaces?: Omit<MapSurfaceLayerProps, "layoutId" | "style">;
};

const inlineSvgCache = new Map<string, string>();

function sanitizeInlineSvg(svg: string) {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/\spreserveAspectRatio\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/<svg\b/i, '<svg preserveAspectRatio="xMidYMid slice"');
}

function InlineSvgOverlay({ className, src, style }: { className: string; src: string; style?: CSSProperties }) {
  const [svg, setSvg] = useState(() => inlineSvgCache.get(src) ?? "");

  useEffect(() => {
    let isMounted = true;
    const cachedSvg = inlineSvgCache.get(src);

    if (cachedSvg) {
      setSvg(cachedSvg);
      return;
    }

    setSvg("");
    fetch(src)
      .then((response) => (response.ok ? response.text() : Promise.reject()))
      .then((rawSvg) => {
        const nextSvg = sanitizeInlineSvg(rawSvg);
        inlineSvgCache.set(src, nextSvg);
        if (isMounted) {
          setSvg(nextSvg);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSvg("");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [src]);

  if (!svg) {
    return <img alt="" aria-hidden="true" className={className} draggable={false} src={src} style={style} />;
  }

  return <span aria-hidden="true" className={`${className} map-layer-inline-svg`} dangerouslySetInnerHTML={{ __html: svg }} style={style} />;
}

function getLayerStyle(layout: MapLayout, includeFloorOffset = false): CSSProperties | undefined {
  const transforms: string[] = [];

  if (includeFloorOffset && layout.floorOffset) {
    transforms.push(`translate(${layout.floorOffset.x}px, ${layout.floorOffset.y}px)`);
  }

  if (layout.imageTransform) {
    const x = layout.imageTransform.x ?? 0;
    const y = layout.imageTransform.y ?? 0;
    const scale = layout.imageTransform.scale ?? 1;
    transforms.push(`translate(${x}px, ${y}px) scale(${scale})`);
  }

  if (transforms.length === 0) {
    return undefined;
  }

  return {
    transform: transforms.join(" "),
    transformOrigin: "center center",
  };
}

export function MapLayoutImage({
  layout,
  map,
  showBombsites = false,
  showCallouts = false,
  showMapMods = false,
  surfaces,
}: MapLayoutImageProps) {
  const alt = `${map.name} ${layout.label} Layout`;
  const baseLayerStyle = getLayerStyle(layout);
  const floorLayerStyle = getLayerStyle(layout, true);

  if (!layout.baseImage) {
    return <img alt={alt} draggable={false} src={layout.image} />;
  }

  return (
    <span className="map-layer-stack">
      <img alt={alt} className="map-layer-base" draggable={false} src={layout.baseImage} style={baseLayerStyle} />
      {layout.floorImage ? (
        <img alt="" aria-hidden="true" className="map-layer-floor" draggable={false} src={layout.floorImage} style={floorLayerStyle} />
      ) : null}
      {showCallouts && layout.calloutImage ? (
        <InlineSvgOverlay className="map-layer-overlay map-layer-callouts" src={layout.calloutImage} style={baseLayerStyle} />
      ) : null}
      {showMapMods && layout.mapModsImage ? (
        <img alt="" aria-hidden="true" className="map-layer-overlay map-layer-map-mods" draggable={false} src={layout.mapModsImage} style={baseLayerStyle} />
      ) : null}
      {showBombsites && layout.bombsiteImage ? (
        <img alt="" aria-hidden="true" className="map-layer-overlay map-layer-bombsites" draggable={false} src={layout.bombsiteImage} style={baseLayerStyle} />
      ) : null}
      {surfaces ? <MapSurfaceLayer {...surfaces} layoutId={layout.id} mapLayouts={map.layouts} style={baseLayerStyle} /> : null}
    </span>
  );
}
