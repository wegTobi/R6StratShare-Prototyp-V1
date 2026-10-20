import type { CSSProperties } from "react";

const detailedIcons: Record<string, string> = {
  "2:1": "/map-mod-icons/shield.webp",
  "2:2": "/map-mod-icons/observation-blocker.webp",
  "3:0": "/map-mod-icons/barbed-wire.webp",
  "3:1": "/map-mod-icons/bulletproof-camera.webp",
  "3:2": "/map-mod-icons/proximity-alarm.png",
};

export function getMapModIconStyle(sprite: {row:number;col:number}, rotation = 0, detailed = false): CSSProperties {
  const icon = detailed ? detailedIcons[`${sprite.row}:${sprite.col}`] : undefined;
  return {
    backgroundPosition: icon ? "center" : `${sprite.col * 50}% ${sprite.row * (100 / 3)}%`,
    ...(icon ? {backgroundImage:`url("${icon}")`,backgroundSize:"contain"} : {}),
    transform:`rotate(${rotation}deg)`,
  };
}
