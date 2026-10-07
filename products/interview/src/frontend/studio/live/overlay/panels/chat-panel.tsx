// The Transcript & chat panel (the library Panel: a 40 px header, a body that
// scrolls and follows the newest line, and the composer docked under it). The
// body holds speech turns, the person's own messages and one-line capture event
// chips, and nothing else: recording and other system status is never written
// into it. Each bubble can be copied, a merged phrase says `edited`, and an
// answer's bubble can be chosen to bring its task into the answer and code
// panes. It takes the one panel session and renders it; none of it fetches or
// decides anything itself.
import {
  IconButton,
  Input,
  Panel,
  SendButton,
  sendStateOf,
  Transcript,
  type TranscriptEntry,
  type TranscriptSpeech,
} from "@oc-tech/omni-ui-components";
import { highlightLines } from "@oc-tech/omni-ui-components/highlight";
import {
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "../../../icon";
import { copyText } from "../../shared/copy-text";
import { followUpNote } from "../../shared/revisions";
import { captureEventChips } from "./answer-meta";
import { FOCUS_INPUT_EVENT } from "./commands";
import {
  clock,
  draftProblemRow,
  followUpPlaceholder,
  type PanelRow,
  panelRows,
} from "./panel-model";
import type { PanelSession } from "./panel-views";
import { TOAST_TEXT } from "./use-panel-session";

// How long a copied bubble says "Copied".
const COPIED_MS = 1_600;
const CHOOSE_TITLE = "Show this answer";
const JUMP_LABEL = "Jump to the latest";

// The app's coding languages, as the highlighter names them.
const GRAMMAR: Record<string, string> = {
  typescript: "typescript",
  react: "tsx",
  php: "php",
  ruby: "ruby",
};

// **bold** inside a line is a marker the transcript does not draw: its words
// are kept, the asterisks are not.
const plain = (text: string): string => text.replaceAll("**", "");

// The words of a bubble, as they would be copied: an answer's lines, or the text.
const bubbleText = (row: PanelRow): string =>
  (row.items ? row.items.map((item) => item.text).join("\n") : row.text) ?? "";

// A task's current stage with the time it has taken: "Solutioning… 12s".
function stageText(row: PanelRow, now: number): string {
  if (!row.stage) return "";
  const seconds = Math.max(0, Math.round((now - row.stage.since) / 1000));
  return `${row.stage.label}…${seconds >= 3 ? ` ${seconds}s` : ""}`;
}

// An assistant row as bubble blocks: consecutive lines are one text block,
// fenced code is a code block (highlighted by the transcript), and the stage,
// while there is one, closes the bubble.
function answerBlocks(
  row: PanelRow,
  language: string | undefined,
  now: number,
): NonNullable<TranscriptSpeech["blocks"]> {
  const blocks: NonNullable<TranscriptSpeech["blocks"]> = [];
  for (const item of row.items ?? []) {
    const last = blocks[blocks.length - 1];
    if (item.kind === "code")
      blocks.push({
        type: "code",
        code: item.text,
        ...(language ? { language } : {}),
      });
    else if (last?.type === "text") last.text += `\n${plain(item.text)}`;
    else blocks.push({ type: "text", text: plain(item.text) });
  }
  if (row.stage) blocks.push({ type: "text", text: stageText(row, now) });
  if (blocks.length === 0 && row.text)
    blocks.push({ type: "text", text: plain(row.text) });
  return blocks;
}

type Shown = { entry: TranscriptEntry; row?: PanelRow };

// The transcript's entries, oldest first: what was heard, what was typed, the
// answers, and a chip for each capture, with the words still being heard last.
function shownEntries(
  s: PanelSession,
  now: number,
  language: string | undefined,
): Shown[] {
  const rows = panelRows(s.model, s.entries, s.clearedAt, s.revisionPicks);
  // A new problem captured and not yet applied closes the conversation.
  if (s.open && s.tray.intent === "new" && s.tray.items.length > 0)
    rows.push(draftProblemRow(s.tray.items.length, now));
  const chips = captureEventChips({
    observations: s.snapshot.observations,
    noQuestion: s.model.noQuestion,
  }).filter((chip) => chip.at > s.clearedAt);
  const speech = (row: PanelRow): TranscriptEntry => {
    const base = {
      id: row.key,
      speaker: row.label,
      time: clock(row.shownAt ?? row.at),
    };
    if (row.kind === "problem")
      return { ...base, kind: "speech", tone: "accent", text: row.text };
    if (row.kind === "assistant")
      return {
        ...base,
        kind: "speech",
        tone: "accent",
        text: bubbleText(row),
        blocks: answerBlocks(row, language, now),
      };
    return {
      ...base,
      kind: "speech",
      tone: row.speaker === "you" ? "success" : "neutral",
      text: row.text,
      ...(row.edited ? { edited: true } : {}),
    };
  };
  const timeline: (Shown & { at: number })[] = [
    ...rows.map((row) => ({
      at: row.at,
      row,
      entry:
        row.kind === "typed"
          ? ({ kind: "message", id: row.key, text: row.text } as const)
          : speech(row),
    })),
    ...chips.map((chip) => ({
      at: chip.at,
      entry: {
        kind: "event" as const,
        id: chip.key,
        icon: (
          <Icon
            name={
              chip.kind === "no-question"
                ? "visibility_off"
                : "screenshot_monitor"
            }
          />
        ),
        text: chip.time ? `${chip.label} · ${chip.time}` : chip.label,
      },
    })),
  ].sort((a, b) => a.at - b.at);
  const heard: Shown[] =
    s.live.interim === ""
      ? []
      : [
          {
            entry: {
              kind: "speech",
              id: "interim",
              speaker: "Listening",
              tone: "success",
              time: clock(now),
              text: s.live.interim,
              interim: true,
            },
          },
        ];
  return [...timeline, ...heard];
}

// An answer's bubble is a button that shows its task. The library's bubbles
// have no per-entry press, so the bubbles of answers (the transcript's children,
// one per entry, in order) are marked here and one listener on the log answers
// for them.
function useChooseAnswers(
  log: RefObject<HTMLDivElement | null>,
  shown: readonly Shown[],
  selectedTaskId: string | undefined,
  onSelect: (taskId: string) => void,
) {
  useLayoutEffect(() => {
    const bubbles = log.current?.children;
    shown.forEach(({ row }, at) => {
      const bubble = bubbles?.[at];
      if (!(bubble instanceof HTMLElement)) return;
      const taskId = row?.taskId;
      if (taskId === undefined) return;
      bubble.setAttribute("role", "button");
      bubble.setAttribute("tabindex", "0");
      bubble.setAttribute("title", CHOOSE_TITLE);
      bubble.setAttribute("data-kind", "assistant");
      bubble.setAttribute("aria-pressed", String(taskId === selectedTaskId));
    });
  });
  const taskOf = (target: EventTarget | null): string | undefined => {
    const root = log.current;
    let node = target instanceof Element ? target : null;
    while (node && node.parentElement !== root) node = node.parentElement;
    const at = node ? [...(root?.children ?? [])].indexOf(node) : -1;
    return shown[at]?.row?.taskId;
  };
  return {
    onClick: (event: MouseEvent<HTMLDivElement>) => {
      // The copy control is inside the bubble: its press stops there.
      if ((event.target as Element).closest('[data-slot="transcript-copy"]'))
        return;
      const taskId = taskOf(event.target);
      if (taskId !== undefined) onSelect(taskId);
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const taskId = taskOf(event.target);
      if (
        taskId === undefined ||
        (event.target as Element).tagName === "BUTTON"
      )
        return;
      event.preventDefault();
      onSelect(taskId);
    },
  };
}

export function ChatPanel({ s }: { s: PanelSession }) {
  // A follow-up is on its way to the server: the reply is not here yet.
  const answering = s.snapshot.pending.includes("follow-up");
  const recording = s.live.mic === "listening";
  // The clock behind "Solutioning… 12s": it ticks only while a stage shows.
  const [now, setNow] = useState(() => Date.now());
  const language = GRAMMAR[s.prefs?.settings?.language ?? ""];
  const shown = shownEntries(s, now, language);
  const staged = shown.some(({ row }) => row?.stage !== undefined);
  useEffect(() => {
    if (!staged) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [staged]);
  const last = shown[shown.length - 1]?.row;
  const log = useRef<HTMLDivElement>(null);
  const choose = useChooseAnswers(log, shown, s.selected?.taskId, s.select);

  // Copying a bubble: the toast says so after the write, or says it failed.
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyBubble = async (entry: TranscriptEntry) => {
    const row = shown.find((each) => each.entry.id === entry.id)?.row;
    const text = row ? bubbleText(row) : "text" in entry ? entry.text : "";
    if (text.trim() === "") return;
    const ok = await copyText(text);
    if (ok) {
      s.toast(TOAST_TEXT.copied("message"));
      setCopied(entry.id);
    } else s.notify("Couldn’t copy the message. Select it and copy by hand.");
  };

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener(FOCUS_INPUT_EVENT, focus);
    return () => window.removeEventListener(FOCUS_INPUT_EVENT, focus);
  }, []);
  const hasText = s.draft.trim() !== "";
  const submit = async () => {
    const text = s.draft.trim();
    if (text === "" || !s.open) return;
    const result = await s.send(text);
    // Words typed while it was sending stay in the box.
    if (result.ok) s.setDraft((now) => (now.trim() === text ? "" : now));
  };
  const followUp =
    s.selected && s.card ? followUpNote(s.selected, s.card.revision) : null;

  return (
    <Panel
      title="Transcript & chat"
      data-testid="pn-chat"
      bodyPadding="sm"
      scroll={{
        fade: true,
        thinScrollbar: true,
        stickToBottom: true,
        lines: shown.length,
        activity: `${answering}-${last?.stage?.label}-${last?.items?.length ?? 0}-${s.live.interim}`,
        jumpLabel: JUMP_LABEL,
      }}
      dockClassName="bg-transparent px-3 py-2.5"
      dock={
        <div
          style={{
            display: "flex",
            flex: "1 1 100%",
            flexDirection: "column",
            gap: 6,
            minWidth: 0,
          }}
        >
          {s.note && (
            <p className="pn-note" data-text-surface="" role="alert">
              <span>{s.note}</span>
            </p>
          )}
          {followUp && (
            <p
              className="pn-muted"
              role="status"
              data-testid="pn-followup-note"
            >
              {followUp}
            </p>
          )}
          <Input
            variant="panel"
            aria-label="Message"
            ref={inputRef}
            className="h-[34px]"
            placeholder={followUpPlaceholder(s.target?.targetLabel ?? null)}
            value={s.draft}
            disabled={!s.open}
            onChange={(next) => s.setDraft(next)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing)
                return;
              event.preventDefault();
              void submit();
            }}
            actions={
              <>
                <IconButton
                  variant="ghost"
                  iconSize="md"
                  icon={<Icon name="mic" filled={recording} />}
                  label={recording ? "Stop microphone" : "Start microphone"}
                  pressed={recording}
                  {...(recording ? { tone: "danger" as const } : {})}
                  disabled={!s.open}
                  className="size-[34px] rounded-[9px]"
                  onClick={() => s.press("toggle-mic")}
                />
                <SendButton
                  state={sendStateOf({ streaming: false, hasDraft: hasText })}
                  sendIcon={<Icon name="arrow_upward" />}
                  labels={{ send: "Send message" }}
                  {...(s.open ? {} : { disabled: true })}
                  className="size-[34px] rounded-[9px]"
                  onClick={() => void submit()}
                />
              </>
            }
          />
        </div>
      }
    >
      <Transcript
        ref={log}
        aria-label="Transcript and chat"
        entries={shown.map(({ entry }) => entry)}
        copyIcon={<Icon name="content_copy" />}
        copiedIcon={<Icon name="check" />}
        copyLabel="Copy message"
        onCopy={(entry) => void copyBubble(entry)}
        copiedId={copied}
        highlight={highlightLines}
        {...choose}
      />
      {answering && (
        <p
          role="status"
          data-testid="pn-pending"
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            color: "var(--oui-panel-meta-fg)",
          }}
        >
          Answering your follow-up…
        </p>
      )}
    </Panel>
  );
}
