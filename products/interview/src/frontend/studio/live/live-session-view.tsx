import type {
  LiveAction,
  LiveObservation,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityTab } from "./activity-tab";
import type { BannerAction, BannerHost } from "./banner-copy";
import { presentation, usePresentation } from "./focus-presentation";
import { studioHostInfo } from "./host-adapter";
import { HandsFreeContext } from "./overlay/hands-free-context";
import { PairingPanel } from "./pairing-panel";
import { SessionBanners } from "./session-banner-list";
import { SessionBar } from "./session-bar";
import { sourcesNeedAttention } from "./session-bar-model";
import type { SessionActions, SessionCommand } from "./session-snapshot";
import type { LiveViewModel } from "./session-state";
import { type SessionTabId, SessionTabs } from "./session-tabs";
import { transcriptLabels } from "./session-transcript";
import { CaptureProblemBanner } from "./shared/capture-problem-banner";
import { copyText } from "./shared/copy-text";
import { pickOf, taskAtRevision } from "./shared/revisions";
import { taskCardModel } from "./shared/task-card-model";
import { selectedTask } from "./shared/task-target";
import { useMissingContext } from "./shared/use-missing-context";
import { actionsVersion } from "./shared/use-screenshots-view";
import { SourcesTab } from "./sources-tab";
import {
  IdleState,
  StagingOnly,
  TaskPanel,
  TaskSelector,
  type WebScreenshots,
} from "./task-panels";
import { TranscriptTab } from "./transcript-tab";
import {
  type CompanionCapabilityState,
  useCompanionCapability,
} from "./use-companion-capability";
import { useLiveSession } from "./use-live-session";
import { useMissingContextActions } from "./use-missing-context-actions";

const TOAST_MS = 3_000;
const CAPABILITY_REFRESH_MS = 15_000;

// A session that is open (created, active or paused): the live header, the
// banners, the task panels and the Transcript, Activity and Sources tabs.
// Everything comes from `useLiveSession()`. New results are announced politely
// and never move focus.
export function LiveSessionPanel() {
  const { snapshot, actions, model } = useLiveSession();
  // The companion reports when it starts, after this panel is already open.
  const capability = useCompanionCapability(CAPABILITY_REFRESH_MS);
  return (
    <div className="live-page" data-testid="live-panel">
      <SessionBar variant="header" />
      {snapshot.session && <CaptureNotice />}
      {snapshot.session && (
        <LiveSessionBody
          session={snapshot.session}
          model={model}
          stream={snapshot}
          actions={actions}
          busy={snapshot.pending.length > 0}
          pending={snapshot.pending}
          commandError={snapshot.commandError}
          pairing={<PairingPanel />}
          capability={capability}
          // A credential that was just issued is shown once: open the tab that
          // holds it rather than leave it behind another.
          initialTab={snapshot.pairing ? "sources" : "transcript"}
          initialPairing={snapshot.pairing !== null}
        />
      )}
    </div>
  );
}

// Why the last capture from this page did not work: the capture-problem banner
// until dismissed or the next capture works, and the controller's own note.
function CaptureNotice() {
  const hf = useContext(HandsFreeContext);
  if (!hf) return null;
  return (
    <>
      {hf.captureProblem && (
        <CaptureProblemBanner
          problem={hf.captureProblem}
          onDismiss={hf.dismissCaptureProblem}
          {...(hf.captureProblemAction
            ? { onAction: hf.captureProblemAction }
            : {})}
        />
      )}
      {hf.note && (
        <p className="live-note" role="alert">
          {hf.note}
        </p>
      )}
    </>
  );
}

// The body, taking its data as props so every state can be rendered from a
// derived model alone.
export function LiveSessionBody({
  session,
  model,
  stream,
  actions,
  busy,
  pending = [],
  commandError,
  pairing,
  capability,
  initialTab = "transcript",
  initialPairing = false,
  host = studioHostInfo() ? "native" : "browser",
}: {
  session: LiveSessionView;
  model: LiveViewModel;
  // What the task card reads beside the model: model labels and screenshots.
  stream: {
    actions: readonly LiveAction[];
    observations: readonly LiveObservation[];
  };
  actions: SessionActions;
  busy: boolean;
  pending?: readonly SessionCommand[];
  commandError: string | null;
  pairing: ReactNode;
  // The companion's last capability report; omitted when none was read.
  capability?: CompanionCapabilityState;
  initialTab?: SessionTabId;
  // The pairing panel starts open when a credential was just issued.
  initialPairing?: boolean;
  // Where the page runs: decides which button a lost-source banner offers.
  host?: BannerHost;
}) {
  const [tab, setTab] = useState<SessionTabId>(initialTab);
  // The credential panel is revealed by an explicit action, never by default.
  const [pairingOpen, setPairingOpen] = useState(initialPairing);
  // null follows the newest task; an id pins an earlier one. The pin is the
  // presentation's, shared with the card and the follow-up box, so a follow-up
  // or an added screenshot goes to the task on show.
  const { pinnedTaskId: pinned, revisionPicks } = usePresentation();
  const setPinned = presentation.pin;
  const [toast, setToast] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  const tabsTop = useRef<HTMLDivElement>(null);
  const seenRuns = useRef<Set<string> | null>(null);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const tasks = model.tasks;
  const newest = tasks[tasks.length - 1];
  const selected = selectedTask(tasks, pinned);
  const card = taskCardModel({
    tasks,
    actions: stream.actions,
    observations: stream.observations,
    selectedTaskId: pinned,
    revisionPicks,
    deviceOnly: session.processingPolicy === "device-only",
  });
  const { missing, dismiss } = useMissingContext(session.id, card);
  const missingActions = useMissingContextActions(dismiss);
  // The screenshots area needs the page's one hands-free controller (it owns the
  // share the staged captures come from); without one the area is not drawn.
  const hf = useContext(HandsFreeContext);
  const screenshots: WebScreenshots | undefined = hf
    ? {
        tray: hf.tray,
        tenant: hf.tenant,
        sessionId: session.id,
        version: actionsVersion(stream.actions),
        policy: session.processingPolicy,
        onAdd: (intent) => void hf.stage(intent),
        unavailable: !hf.open
          ? "The session is not taking captures now."
          : !hf.owns
            ? "Another Studio window owns the screen. Add the screenshot there."
            : null,
      }
    : undefined;

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

  const labels = useMemo(
    () =>
      transcriptLabels({
        tasks,
        actions: stream.actions,
        observations: stream.observations,
      }),
    [tasks, stream.actions, stream.observations],
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
    setPairingOpen(true);
    showSources();
    if (session.status === "paused") await actions.resume();
  };
  const onBanner = async (action: BannerAction) => {
    if (action === "sources") return showSources();
    if (action === "pair") {
      setPairingOpen(true);
      return showSources();
    }
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
      <SessionBanners
        model={model}
        host={host}
        busy={busy}
        onAction={onBanner}
      />
      <div className="live-columns">
        <div className="live-main">
          {selected && card ? (
            <>
              <TaskSelector
                tasks={tasks}
                selectedId={selected.taskId}
                onSelect={(taskId) =>
                  setPinned(taskId === newest?.taskId ? null : taskId)
                }
              />
              <TaskPanel
                task={taskAtRevision(selected, card.revision)}
                card={card}
                session={session}
                policy={model.locality?.policy ?? null}
                onCopy={copy}
                onBackToNow={() => setPinned(null)}
                onPickRevision={(revision) =>
                  presentation.pickRevision(
                    selected.taskId,
                    pickOf(selected, revision),
                  )
                }
                missing={missing ? { items: missing, ...missingActions } : null}
                {...(screenshots ? { screenshots } : {})}
              />
            </>
          ) : (
            <>
              <IdleState model={model} />
              <StagingOnly {...(screenshots ? { screenshots } : {})} />
            </>
          )}
        </div>
        <div ref={tabsTop} className="live-rail">
          <SessionTabs
            tab={tab}
            onTab={setTab}
            alerts={{ sources: sourcesNeedAttention(model) }}
          >
            {tab === "transcript" && (
              <TranscriptTab
                rows={model.transcript}
                sessionId={session.id}
                sessionStart={session.createdAt}
                labels={labels}
                revisionPicks={revisionPicks}
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
                pairingOpen={pairingOpen}
                onPair={() => setPairingOpen(true)}
                pending={pending}
                {...(capability ? { capability } : {})}
              />
            )}
          </SessionTabs>
        </div>
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
