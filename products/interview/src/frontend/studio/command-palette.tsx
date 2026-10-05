import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./icon";
import { Dialog } from "./shared/dialog";
import { formatShortcut } from "./use-shortcuts";

export type PaletteItem = {
  id: string;
  group: string;
  label: string;
  icon: IconName;
  shortcut?: string | undefined;
  run(): void;
};

// ⌘K: one list of everything you can go to or do, filtered as you type.
export function CommandPalette({
  items,
  onClose,
}: {
  items: readonly PaletteItem[];
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(needle));
  }, [items, query]);
  const selected = Math.min(active, Math.max(0, matches.length - 1));

  function run(item: PaletteItem | undefined) {
    if (!item) return;
    onClose();
    item.run();
  }

  return (
    <Dialog
      title="Command palette"
      onClose={onClose}
      scrimClassName="studio-palette-scrim"
      className="studio-palette"
    >
      <div className="studio-palette-search">
        <Icon name="search" />
        <input
          ref={input}
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="studio-palette-list"
          aria-activedescendant={
            matches[selected] ? `palette-${matches[selected].id}` : undefined
          }
          aria-label="Search questions, briefings, or type a command"
          placeholder="Search questions, briefings, or type a command"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive(Math.min(selected + 1, matches.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive(Math.max(selected - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(matches[selected]);
            }
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div
        className="studio-palette-list"
        id="studio-palette-list"
        role="listbox"
      >
        {matches.map((item, index) => (
          <div key={item.id} role="presentation">
            {item.group !== matches[index - 1]?.group && (
              <div className="studio-palette-group" role="presentation">
                {item.group}
              </div>
            )}
            <button
              type="button"
              id={`palette-${item.id}`}
              role="option"
              aria-selected={index === selected}
              className="studio-palette-item"
              onMouseEnter={() => setActive(index)}
              onClick={() => run(item)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.shortcut && <kbd>{formatShortcut(item.shortcut)}</kbd>}
            </button>
          </div>
        ))}
        {!matches.length && (
          <div className="studio-palette-empty">No matches</div>
        )}
      </div>
    </Dialog>
  );
}
