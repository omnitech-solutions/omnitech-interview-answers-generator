import type { LiveSessionView } from "@omnitech/interview-contracts";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { StudioActions } from "../config/commands";
import { Icon } from "../icon";
import { ActivityTab } from "./activity-tab";
import type { BannerAction } from "./banner-copy";
import { PairingPanel } from "./pairing-panel";
import { SessionBanners } from "./session-banner-list";
import { SessionBar } from "./session-bar";
import type { SessionActions } from "./session-snapshot";
import type { LiveViewModel } from "./session-state";
import { type SessionTabId, SessionTabs } from "./session-tabs";
import { SourcesTab } from "./sources-tab";
import { IdleState, TaskPanel, TaskSelector } from "./task-panels";
import { TranscriptTab } from "./transcript-tab";
import { useLiveSession } from "./use-live-session";

export type LiveSessionPanelProps = {
  // Studio navigation, for opening the session draft in the Workspace.
  studio: StudioActions;
};

const TOAST_MS = 3_000;

// Copy with the async clipboard, falling back to a hidden selection for a page
// that may not use it. True when the text was copied.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection route.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

// A session that is open (created, active or paused): the live header, the
// banners, the task panels and the Transcript, Activity and Sources tabs.
// Everything comes from `useLiveSession()`. New results are announced politely
// and never move focus.
export function LiveSessionPanel(_props: LiveSessionPanelProps) {
  const { snapshot, actions, model } = useLiveSession();
  return (
    <div className="live-page" data-testid="live-panel">
      <SessionBar variant="header" onOpen={() => undefined} />
      {snapshot.session && (
        <LiveSessionBody
          session={snapshot.session}
          model={model}
          actions={actions}
          busy={snapshot.pending.length > 0}
          commandError={snapshot.commandError}
          pairing={<PairingPanel />}
        />
      )}
    </div>
  );
}

// The body, taking its data as props so every state can be rendered from a
// derived model alone.
export function LiveSessionBody({
  session,
  model,
  actions,
  busy,
  commandError,
  pairing,
}: {
  session: LiveSessionView;
  model: LiveViewModel;
  actions: SessionActions;
  busy: boolean;
  commandError: string | null;
  pairing: ReactNode;
}) {
  const [tab, setTab] = useState<SessionTabId>("transcript");
  // null follows the newest task; an id pins an earlier one.
  const [pinned, setPinned] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  const tabsTop = useRef<HTMLDivElement>(null);
  const seenRuns = useRef<Set<string> | null>(null);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const tasks = model.tasks;
  const newest = tasks[tasks.length - 1];
  const selected = tasks.find((task) => task.taskId === pinned) ?? newest;
  const viewingEarlier =
    selected !== undefined && newest !== undefined && selected !== newest;
  const selectedNumber = selected ? tasks.indexOf(selected) + 1 : 0;

  // A result that arrives is announced, once, without moving focus.
  useEffect(() => {
    const published = model.runs.filter((run) => run.state === "published");
    if (seenRuns.current === null) {
      seenRuns.current = new Set(published.map((run) => run.id));
      return;
    }
    const seen = seenRuns.current;
    const fresh = published.filter((run) => !seen.has(run.id));
    for (const run of fresh) seen.add(run.id);
    const last = fresh[fresh.length - 1];
    if (last)
      setAnnouncement(
        last.actionKind === "solve-code"
          ? "A coding draft is ready."
          : "An answer draft is ready.",
      );
  }, [model.runs]);

  const say = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(""), TOAST_MS);
  }, []);
  const copy = useCallback(
    async (text: string) =>
      say(
        (await copyText(text))
          ? "Copied answer"
          : "Couldn’t copy. Select the text and copy it yourself.",
      ),
    [say],
  );

  const showSources = () => {
    setTab("sources");
    tabsTop.current?.scrollIntoView?.({ block: "start" });
  };
  // Renewal first, then resume: resume answers credential_renewal_required
  // until the owner has replaced an expired or revoked credential.
  const renewThenResume = async () => {
    const renewed = await actions.renewCredential();
    if (!renewed.ok) return;
    showSources();
    if (session.status === "paused") await actions.resume();
  };
  const onBanner = async (action: BannerAction) => {
    if (action === "sources") return showSources();
    if (action === "renew") return renewThenResume();
    const resumed = await actions.resume();
    if (!resumed.ok && resumed.code === "credential_renewal_required")
      await renewThenResume();
  };

  return (
    <div className="live-session">
      {commandError && (
        <p className="live-note" role="alert">
          That didn’t work ({commandError}). The session is unchanged.
        </p>
      )}
      <SessionBanners model={model} busy={busy} onAction={onBanner} />
      {viewingEarlier && (
        <div className="live-banner earlier" role="status">
          <Icon name="history" />
          <span className="live-banner-text">
            Viewing an earlier task. The session is still listening.
          </span>
          <button
            type="button"
            className="live-banner-action"
            onClick={() => setPinned(null)}
          >
            Back to now
          </button>
        </div>
      )}
      {selected ? (
        <>
          <TaskSelector
            tasks={tasks}
            selectedId={selected.taskId}
            onSelect={(taskId) =>
              setPinned(taskId === newest?.taskId ? null : taskId)
            }
          />
          <TaskPanel
            task={selected}
            number={selectedNumber}
            session={session}
            policy={model.locality?.policy ?? null}
            onCopy={copy}
          />
        </>
      ) : (
        <IdleState model={model} />
      )}
      <div ref={tabsTop}>
        <SessionTabs tab={tab} onTab={setTab}>
          {tab === "transcript" && (
            <TranscriptTab
              rows={model.transcript}
              sessionId={session.id}
              sessionStart={session.createdAt}
            />
          )}
          {tab === "activity" && (
            <ActivityTab runs={model.runs} tasks={tasks} />
          )}
          {tab === "sources" && (
            <SourcesTab
              model={model}
              session={session}
              actions={actions}
              pairing={pairing}
            />
          )}
        </SessionTabs>
      </div>
      <div className="live-toast" role="status">
        {toast}
      </div>
      <div className="live-sr" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
