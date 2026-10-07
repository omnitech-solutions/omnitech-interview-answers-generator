// The screen picker (D33), now the chevron of the capture control: a menu of
// "Follow my browser" and one row per display with a live thumbnail, opened from
// the chevron, the capture button's right-click or its ArrowDown key. The host
// only offers it ("display-selection"), so the web has none.
//
// [SAFETY] Thumbnails show what is on the owner's displays. They are fetched only
// while the menu is open, held in this component's state, dropped when it closes
// and never stored, logged or sent anywhere.
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@oc-tech/omni-ui-components";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "../../../icon";
import {
  listHostDisplays,
  setHostCaptureDisplay,
  syncHostPin,
} from "../../host-adapter";
import { noteSource, useCaptureSource } from "../../host-display";
import {
  LOADING,
  listNotice,
  listStateOf,
  nextRefreshDelay,
  PIN_DROPPED_NOTE,
  pickerRows,
  screenButtonName,
} from "./display-picker-model";
import type { PanelSession } from "./panel-views";
import { usePortalRoot } from "./portal-root";
import { SCREEN_CONTROL } from "./toolbar-config";
import { useToolbarLock } from "./toolbar-lock";

const ITEM = '[role^="menuitem"]:not([aria-disabled="true"])';

// Lists the displays now and again every DISPLAY_REFRESH_MS, for as long as the
// component that calls it is mounted (the menu's body, so: while it is open). A
// response that arrives after that is ignored.
function useDisplayList() {
  const [list, setList] = useState(LOADING);
  const [round, setRound] = useState(0);
  useEffect(() => {
    // `round` restarts the loop for an immediate refresh.
    void round;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const startedAt = Date.now();
      const listing = await listHostDisplays();
      if (!live) return;
      setList(listStateOf(listing));
      timer = setTimeout(
        () => void run(),
        nextRefreshDelay(startedAt, Date.now()),
      );
    };
    void run();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [round]);
  return { list, refresh: useCallback(() => setRound((n) => n + 1), []) };
}

function ScreenMenu({ close }: { close: () => void }) {
  const source = useCaptureSource();
  const { list, refresh } = useDisplayList();
  const notice = listNotice(list);
  const choose = async (displayId: number | null) => {
    const outcome = await setHostCaptureDisplay(displayId);
    if (outcome === "ok") close();
    // The display went away: the shell's answer unpinned it (and the toast says
    // so); the list is read again so the rows are true.
    else if (outcome === "display-unavailable") refresh();
  };
  return (
    <>
      {pickerRows(list, source).map((row) =>
        row.kind === "follow" ? (
          <button
            key="follow"
            type="button"
            role="menuitemradio"
            aria-checked={row.checked}
            className="pn-display-row"
            onClick={() => void choose(null)}
          >
            <Icon name="check" style={{ opacity: row.checked ? 1 : 0 }} />
            <span>
              <span className="pn-display-text">
                <span className="pn-display-label">{row.label}</span>
                <span className="pn-display-sub">{row.sub}</span>
              </span>
            </span>
          </button>
        ) : (
          <button
            key={row.id}
            type="button"
            role="menuitemradio"
            aria-checked={row.checked}
            aria-label={`${row.name}, ${row.position}`}
            className="pn-display-row"
            data-testid="pn-display-row"
            onClick={() => void choose(row.id)}
          >
            <Icon name="check" style={{ opacity: row.checked ? 1 : 0 }} />
            <span className="pn-display-body">
              <img
                className="pn-display-thumb"
                src={row.thumbnailSrc}
                alt={row.name}
                draggable={false}
              />
              <span className="pn-display-label">{row.name}</span>
              <span className="pn-display-sub">{row.position}</span>
            </span>
          </button>
        ),
      )}
      {notice && (
        <div className="pn-display-notice" role="status">
          {notice.text}
          {notice.help && <small>{notice.help}</small>}
        </div>
      )}
    </>
  );
}

export function ScreenPicker({
  s,
  open,
  onOpenChange,
  returnFocus,
}: {
  s: PanelSession;
  open: boolean;
  onOpenChange(open: boolean): void;
  returnFocus?: () => HTMLElement | null;
}) {
  const source = useCaptureSource();
  const { pinDropped } = source;
  const toast = s.toast;
  // A fresh page learns the shell's saved pin once, on mount, without any
  // thumbnail being taken (those are only for the open menu).
  useEffect(() => {
    void syncHostPin();
  }, []);
  // ONE line when a pin was dropped (from a capture, a watch or a failed
  // choice), then the shell's own state says follow.
  useEffect(() => {
    if (!pinDropped) return;
    toast({ title: PIN_DROPPED_NOTE, detail: "" });
    noteSource({ kind: "told" });
  }, [pinDropped, toast]);
  const name = screenButtonName(source);
  // Before a session runs the trigger is disabled and says what is missing.
  const lock = useToolbarLock();
  const portal = usePortalRoot();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  // Closing by Escape, Tab or a choice returns focus to the button (or where
  // `returnFocus` says); a press elsewhere leaves it where the person pointed.
  const closeToButton = () => {
    // The target is read before closing: closing may reset what it depends on.
    const target = returnFocus?.() ?? trigger.current;
    onOpenChange(false);
    target?.focus();
  };
  const onPanelKey = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeToButton();
      return;
    }
    if (event.key === "Tab") {
      closeToButton();
      return;
    }
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const items = [
      ...(panel.current?.querySelectorAll<HTMLElement>(ITEM) ?? []),
    ];
    if (step === 0 || items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <span className="pn-popover">
        <PopoverTrigger asChild>
          <button
            ref={(element) => {
              trigger.current = element;
              portal.ref(element);
            }}
            type="button"
            className="pn-split-menu pn-screen-button"
            aria-label={name}
            title={lock ?? name}
            disabled={lock !== null}
            aria-haspopup="menu"
            data-testid="pn-screen"
          >
            <Icon name="expand_more" />
            {source.pinned && (
              <span
                className="pn-pin-dot"
                aria-hidden="true"
                data-testid="pn-pin-dot"
              />
            )}
          </button>
        </PopoverTrigger>
      </span>
      <PopoverContent
        ref={panel}
        container={portal.container}
        role="menu"
        aria-label={SCREEN_CONTROL.label}
        className="pn-display-menu"
        align="start"
        tabIndex={-1}
        onKeyDown={onPanelKey}
        // Focus moves into the menu: the chosen row, else the first.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const first =
            panel.current?.querySelector<HTMLElement>(
              '[aria-checked="true"]',
            ) ?? panel.current?.querySelector<HTMLElement>(ITEM);
          (first ?? panel.current)?.focus();
        }}
        // Focus is placed by closeToButton (or left alone after an outside press).
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <ScreenMenu close={closeToButton} />
      </PopoverContent>
    </Popover>
  );
}
