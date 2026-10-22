import { equippedGadgetTools, parseEquippedGadgets } from "./player-gadgets";
import type { EquippedGadgetType } from "./player-gadgets";

export function EquippedGadgets({ value, onRemove }: { value?: unknown; onRemove?: (type: EquippedGadgetType) => void }) {
  const selected = parseEquippedGadgets(value);
  if (!selected.length) return null;
  return (
    <section className="equipped-gadgets" aria-label="Equipped gadgets">
      <span className="equipped-gadgets-heading">Equipped gadgets</span>
      <ul>
        {selected.map(type => {
          const tool = equippedGadgetTools.find(tool => tool.type === type)!;
          return <li key={type}>
            <img alt="" src={tool.icon} width={24} height={24} />
            <span>{tool.label}</span>
            {onRemove ? <button aria-label={`Unequip ${tool.label}`} title={`Unequip ${tool.label}`} type="button" onClick={() => onRemove(type)}>×</button> : null}
          </li>;
        })}
      </ul>
    </section>
  );
}
