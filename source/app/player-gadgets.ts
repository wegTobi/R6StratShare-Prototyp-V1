export const playerGadgetTools = [
  { label: "Shield", type: "shield", sprite: { row: 2, col: 1 } },
  { label: "Proximity Alarm", type: "proximity-alarm", sprite: { row: 3, col: 2 } },
  { label: "Observation Blocker", type: "observation-blocker", sprite: { row: 2, col: 2 } },
  { label: "Bulletproof Camera", type: "bulletproof-camera", sprite: { row: 3, col: 1 } },
  { label: "Barbed Wire", type: "barbed-wire", sprite: { row: 3, col: 0 } },
] as const;

export type PlayerGadgetType = typeof playerGadgetTools[number]["type"];

// Loadout choices have no floor or map coordinates and never become markers.
export const equippedGadgetTools = [
  { type: "impact-grenade", label: "Impact Grenade", icon: "/player-gadgets/impact-grenade.png" },
  { type: "nitro-cell", label: "Nitro Cell", icon: "/player-gadgets/nitro-cell.png" },
] as const;

export type EquippedGadgetType = typeof equippedGadgetTools[number]["type"];

export function parseEquippedGadgets(value: unknown): EquippedGadgetType[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((type): type is EquippedGadgetType => equippedGadgetTools.some(tool => tool.type === type)))];
}

export function toggleEquippedGadget(value: unknown, type: EquippedGadgetType): EquippedGadgetType[] {
  const current = parseEquippedGadgets(value);
  return current.includes(type) ? current.filter(item => item !== type) : [...current, type];
}

export function getPlayerGadgetTool(type?: string) {
  return playerGadgetTools.find(tool => tool.type === type);
}

// Legacy slot markers without a type are operator abilities.
export function getSlotPlacementLabel(type: string | undefined, index: number, abilityName?: string) {
  return getPlayerGadgetTool(type)?.label ?? abilityName ?? `Ability ${index + 1}`;
}

export function isSlotPlacementVisible(type: string | undefined, slotIndex: number, selectedSlotIndex: number | null, showOtherAbilities: boolean) {
  return selectedSlotIndex === null || slotIndex === selectedSlotIndex || (!getPlayerGadgetTool(type) && showOtherAbilities);
}

export function reorderSlotEquipment<T extends { id: string }>(items: T[], id: string, targetId: string): T[] {
  const from = items.findIndex(item => item.id === id);
  const to = items.findIndex(item => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return items;
  const reordered = [...items];
  const [item] = reordered.splice(from, 1);
  reordered.splice(to, 0, item);
  return reordered;
}
