const mapModificationIconScale = 2.8;
const typeScale: Record<string, number> = {
  "popped-hatch": 1.05,
  "proximity-alarm": 0.72,
  "bulletproof-camera": 0.64,
  shield: 0.72,
  "observation-blocker": 0.8,
  "barbed-wire": 0.8,
};

export function getMapModificationIconScale(type: string) {
  return mapModificationIconScale * (typeScale[type] ?? 1);
}

// Preserve the original size at 100% zoom and soften growth/shrinkage with zoom.
export function getAbilityIconScale(mapZoom: number) {
  return 1 / Math.pow(mapZoom, 0.3);
}
