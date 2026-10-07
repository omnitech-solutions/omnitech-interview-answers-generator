// What the native window shows before a session runs, inside the SAME chrome as
// the live window: the real toolbar (every session control disabled and naming
// what is missing), a titled card, and the real footer. Four stages:
//   out      "Sign in to start a session": Google, LinkedIn, and this Mac
//   waiting  "Finish signing in in your browser" (the shell opened the browser)
//   local    "Use Studio on this Mac only", what that means, Back / Continue
//   idle     "No live session": what to start, the Mac's permissions, Start
// The page decides nothing about identity: the shell runs the browser round trip
// and the web view's own sign-in, and Studio's server says who the member is.
//
// [SAFETY] A button that cannot work is not drawn (no provider Studio offers, no
// bridge); starting is never silent: a session starts only from the Start button,
// after the Mac's permissions and, for an interview, "everyone has agreed".
import type {
  AccountProvider,
  LiveProcessingPolicy,
  PresentationHost,
} from "@omnitech/interview-contracts";
import type { ProductMember } from "@omnitech/platform-contracts";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "../../../icon";
import { loadHandsFreeChoice } from "../../hands-free-choice";
import { openExternalThroughHost } from "../../host-adapter";
import type { SessionErrorCode } from "../../session-client";
import { tenantFromLocation } from "../../session-registry";
import {
  buildStartRequest,
  defaultMatrix,
  initialForm,
  newRehearsalRunId,
} from "../../setup-model";
import { SCREEN_RECORDING_SETTINGS_URL } from "../../shared/capture-problem";
import { useSetupChoices } from "../../use-setup-choices";
import { Footer, failureNote } from "../overlay-footer";
import type { PanelGlass } from "./panel-glass";
import type { PanelSession } from "./panel-views";
import { Popover } from "./popover";
import { openShellConsent, shellConsented } from "./shell-bridge";
import type { Panes } from "./single-panel";
import { StartIcon } from "./start-icons";
import {
  AGREEMENT_TEXT,
  accountLines,
  chipOf,
  EXPIRED_TEXT,
  footerStatus,
  LOCAL_FACTS,
  LOCK_REASON,
  OUT_BLURB,
  OUT_NOTE,
  type PermissionRow,
  PROVIDER_NAME,
  permissionRows,
  SIGNED_OUT_TOAST,
  STAGE_TITLE,
  type StartStage,
  type StartTarget,
  signOutLabel,
  startBlock,
  startHint,
  startTargets,
  TIMED_OUT_TEXT,
} from "./start-model";
import { Toolbar } from "./toolbar";
import { ToolbarLock } from "./toolbar-lock";
import {
  accountHost,
  markWelcome,
  navigation,
  type Providers,
  panelAddress,
  signInLocal,
  takeWelcome,
  usePermissions,
  useProviders,
  useSignInState,
  windowTenant,
} from "./use-account";
import type { PanelWindowMode } from "./window-mode";

const TOAST_MS = 2_400;
const MICROPHONE_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

// Where "Open Studio on the web" and "Set up in Studio on the web" go.
const webStudioAddress = (): string =>
  `${window.location.origin}/t/${windowTenant()}/p/interview/live`;

export type StartPanelProps = {
  s: PanelSession;
  controls: {
    panes: Panes;
    presentation: PresentationHost;
    glass: PanelGlass;
    windowMode: PanelWindowMode;
  };
  // Signed in with no session (idle), or not signed in (out, waiting, local).
  signedIn: boolean;
  member: ProductMember | null;
  // Studio refused a session that had been working: the "expired" banner.
  expired?: boolean;
  // Why this window opened signed out ("signed-out": the person just did).
  // "unavailable": the session this window was showing is gone.
  notice?: "signed-out" | "unavailable" | null;
  // A session was started here: other windows are told which one it is.
  onStarted(): void;
};

// Said above the start screen when the session the window was showing went away.
const GONE_TEXT =
  "That session is no longer available. Start a new one, or open a running one.";

export function StartPanel(props: StartPanelProps) {
  const { s, controls, signedIn, member } = props;
  const host = useMemo(() => accountHost(), []);
  const signIn = useSignInState(host);
  const [confirmingLocal, setConfirmingLocal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const say = useCallback((text: string) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  // "Signed out" is said once, by the window the sign-out opened.
  useEffect(() => {
    if (props.notice === "signed-out") say(SIGNED_OUT_TOAST);
  }, [props.notice, say]);

  // Read once for the window, so Back from the local step shows the choices at once.
  const { providers, retry } = useProviders();
  const stage: StartStage = signedIn
    ? "idle"
    : signIn.phase === "waiting"
      ? "waiting"
      : confirmingLocal
        ? "local"
        : "out";
  const lock = signedIn ? LOCK_REASON.noSession : LOCK_REASON.signedOut;

  return (
    <>
      <ToolbarLock.Provider value={lock}>
        <Toolbar
          s={s}
          controls={{ ...controls, onMenuOpen: () => undefined }}
          trailing={
            <>
              <span className="pn-divider" aria-hidden="true" />
              {signedIn ? (
                <AccountChip
                  member={member}
                  presentation={controls.presentation}
                  onSignOut={() => void host?.signOut()}
                  canSignOut={Boolean(host)}
                />
              ) : (
                <span className="pn-chip-out" data-testid="pn-chip-out">
                  <StartIcon name="person_off" />
                  Not signed in
                </span>
              )}
            </>
          }
        />
      </ToolbarLock.Provider>
      <section
        className="pn-start-card"
        data-testid="pn-start"
        data-stage={stage}
        aria-label={STAGE_TITLE[stage]}
      >
        <header className="pn-start-title">{STAGE_TITLE[stage]}</header>
        {props.notice === "unavailable" && stage === "idle" && (
          <p className="pn-start-banner" data-tone="warn" role="status">
            <Icon name="warning" />
            <span>{GONE_TEXT}</span>
            <button
              type="button"
              className="pn-bar-button"
              onClick={() => void s.actions.refresh()}
            >
              Try again
            </button>
          </p>
        )}
        {stage === "out" && (
          <SignedOut
            host={host}
            providers={providers}
            retry={retry}
            expired={props.expired === true}
            timedOut={signIn.phase === "timed-out"}
            onLocal={() => setConfirmingLocal(true)}
            say={say}
          />
        )}
        {stage === "waiting" && signIn.phase === "waiting" && (
          <Waiting host={host} provider={signIn.provider} say={say} />
        )}
        {stage === "local" && (
          <LocalConfirm onBack={() => setConfirmingLocal(false)} say={say} />
        )}
        {stage === "idle" && (
          <Idle
            s={s}
            host={host}
            member={member}
            say={say}
            onStarted={props.onStarted}
          />
        )}
      </section>
      <div className="pn-single-foot">
        <Footer
          wording="session"
          variant={{
            kind: "idle",
            status: <StatusLine member={signedIn ? member : null} />,
          }}
          pending={s.snapshot.pending}
          actions={s.actions}
          onFailure={(code) => s.notify(failureNote(code))}
        />
      </div>
      {toast && (
        <div
          className="pn-start-toast"
          role="status"
          data-testid="pn-start-toast"
        >
          {toast}
        </div>
      )}
    </>
  );
}

function StatusLine({ member }: { member: ProductMember | null }) {
  const status = footerStatus(member);
  return (
    <>
      {status.icon === "person_off" ? (
        <StartIcon name="person_off" />
      ) : (
        <Icon name={status.icon} />
      )}
      {status.text}
    </>
  );
}

// ---- The account chip and its menu -----------------------------------------

function AccountChip({
  member,
  presentation,
  onSignOut,
  canSignOut,
}: {
  member: ProductMember | null;
  presentation: PresentationHost;
  onSignOut(): void;
  canSignOut: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!member)
    return (
      <span className="pn-chip-out" data-testid="pn-chip">
        <Icon name="check_circle" />
        Signed in
      </span>
    );
  const chip = chipOf(member);
  const lines = accountLines(member);
  // A development Studio signs every request in as the local owner: there is
  // no session to end, so no sign-out is drawn.
  const signOutShown = member.canSignOut && canSignOut;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      className="pn-chip"
      label="Account"
      triggerLabel={`Account: ${chip.short}`}
      title="Account"
      testId="pn-chip"
      kind="menu"
      panelClassName="pn-menu pn-account-menu"
      trigger={
        <>
          <span className="pn-chip-initial" data-kind={member.kind}>
            {chip.initial}
          </span>
          {chip.short}
          <Icon name="expand_more" />
        </>
      }
    >
      {(close) => (
        <>
          <div className="pn-account-head" role="presentation">
            <span className="pn-account-name">{lines.name}</span>
            <span className="pn-account-via">{lines.via}</span>
          </div>
          <AccountItem
            icon={<Icon name="open_in_new" />}
            label="Open Studio on the web"
            onPick={() => {
              openExternalThroughHost(webStudioAddress());
              close();
            }}
          />
          <AccountItem
            icon={<Icon name="settings" />}
            label="Settings"
            onPick={() => {
              void presentation.openSettings();
              close();
            }}
          />
          {member.kind === "local" && signOutShown && (
            <AccountItem
              icon={<Icon name="link" />}
              label="Sign in with Google or LinkedIn"
              onPick={() => {
                onSignOut();
                close();
              }}
            />
          )}
          {signOutShown && (
            <AccountItem
              icon={<StartIcon name="logout" />}
              label={signOutLabel(member)}
              danger
              onPick={() => {
                onSignOut();
                close();
              }}
            />
          )}
        </>
      )}
    </Popover>
  );
}

function AccountItem({
  icon,
  label,
  onPick,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  onPick(): void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`pn-menu-item${danger ? " pn-menu-danger" : ""}`}
      onClick={onPick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ---- Out --------------------------------------------------------------------

function SignedOut({
  host,
  providers,
  retry,
  expired,
  timedOut,
  onLocal,
  say,
}: {
  host: ReturnType<typeof accountHost>;
  providers: Providers;
  retry(): void;
  expired: boolean;
  timedOut: boolean;
  onLocal(): void;
  say(text: string): void;
}) {
  const begin = async (provider: AccountProvider) => {
    if (!host) return;
    markWelcome();
    if (!(await host.signIn(provider)))
      say("Couldn’t open your browser. Try again.");
  };
  const ready = providers.status === "ready" ? providers : null;
  const anyReal = Boolean(ready?.google || ready?.linkedin);
  const missing = ready
    ? [
        ...(ready.google ? [] : ["Google"]),
        ...(ready.linkedin ? [] : ["LinkedIn"]),
      ]
    : [];
  return (
    <div className="pn-start-body pn-start-out">
      <div>
        <h2 className="pn-start-h">Sign in to start a session</h2>
        <p className="pn-start-sub">{OUT_BLURB}</p>
      </div>
      {expired && (
        <p className="pn-start-banner" data-tone="warn" role="status">
          <Icon name="schedule" />
          <span>{EXPIRED_TEXT}</span>
        </p>
      )}
      {timedOut && (
        <p className="pn-start-banner" data-tone="warn" role="status">
          <Icon name="schedule" />
          <span>{TIMED_OUT_TEXT}</span>
        </p>
      )}
      {!host && (
        <p className="pn-start-note">
          Sign-in starts in the Interview Studio Mac app. In a browser, sign in
          on the web.
        </p>
      )}
      {host && providers.status === "loading" && (
        <p className="pn-start-note" aria-busy="true">
          Checking how you can sign in…
        </p>
      )}
      {host && providers.status === "error" && (
        <div className="pn-start-note">
          <p>Studio didn’t answer. Check that it is running, then try again.</p>
          <button type="button" className="pn-start-quiet" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {host && ready && (
        <div className="pn-start-stack">
          <button
            type="button"
            className="pn-start-provider"
            data-provider="google"
            disabled={!ready.google}
            onClick={() => void begin("google")}
          >
            <span className="pn-start-mark pn-start-mark-g" aria-hidden="true">
              G
            </span>
            Continue with Google
          </button>
          <button
            type="button"
            className="pn-start-provider"
            data-provider="linkedin"
            disabled={!ready.linkedin}
            onClick={() => void begin("linkedin")}
          >
            <span className="pn-start-mark pn-start-mark-in" aria-hidden="true">
              in
            </span>
            Continue with LinkedIn
          </button>
        </div>
      )}
      {host && ready?.local && (
        <div className="pn-start-or" aria-hidden="true">
          <span />
          or
          <span />
        </div>
      )}
      {host && ready?.local && (
        <button
          type="button"
          className="pn-start-local"
          data-testid="pn-start-local"
          onClick={onLocal}
        >
          <StartIcon name="laptop_mac" />
          Continue on this Mac, no account
        </button>
      )}
      {host && ready && anyReal && <p className="pn-start-note">{OUT_NOTE}</p>}
      {host && ready && missing.length > 0 && (
        <p className="pn-start-note">
          {missing.join(" and ")} {missing.length > 1 ? "aren’t" : "isn’t"} set
          up on this Studio.
          {!anyReal &&
            !ready.local &&
            " Ask whoever runs it, or sign in on the web."}
        </p>
      )}
    </div>
  );
}

// ---- Waiting ----------------------------------------------------------------

function Waiting({
  host,
  provider,
  say,
}: {
  host: ReturnType<typeof accountHost>;
  provider: AccountProvider;
  say(text: string): void;
}) {
  return (
    <div className="pn-start-body pn-start-waiting">
      <span className="pn-start-spinner-box" aria-hidden="true">
        <span className="pn-start-spinner" />
      </span>
      <div>
        <h2 className="pn-start-h">Finish signing in in your browser</h2>
        <p className="pn-start-sub">
          We opened {PROVIDER_NAME[provider]} in your default browser. This
          window updates by itself when you’re done.
        </p>
      </div>
      <div className="pn-start-row">
        <button
          type="button"
          className="pn-start-chip"
          onClick={() => void host?.reopenSignIn()}
        >
          <Icon name="open_in_new" />
          Open browser again
        </button>
        <button
          type="button"
          className="pn-start-chip"
          onClick={() =>
            void host
              ?.copySignInLink()
              .then((copied) =>
                say(copied ? "Sign-in link copied" : "Couldn’t copy the link"),
              )
          }
        >
          <Icon name="link" />
          Copy link
        </button>
      </div>
      <button
        type="button"
        className="pn-start-quiet"
        onClick={() => void host?.cancelSignIn()}
      >
        Cancel
      </button>
    </div>
  );
}

// ---- Local ------------------------------------------------------------------

function LocalConfirm({
  onBack,
  say,
}: {
  onBack(): void;
  say(text: string): void;
}) {
  const [working, setWorking] = useState(false);
  const proceed = async () => {
    setWorking(true);
    markWelcome();
    if (await signInLocal()) {
      navigation.assign(panelAddress(windowTenant()));
      return;
    }
    setWorking(false);
    say("Couldn’t sign in on this Mac. Nothing was changed.");
  };
  return (
    <div className="pn-start-body pn-start-local-confirm">
      <div>
        <h2 className="pn-start-h">Use Studio on this Mac only</h2>
        <p className="pn-start-sub">No account and no password.</p>
      </div>
      <ul className="pn-start-facts">
        {LOCAL_FACTS.map((fact) => (
          <li key={fact.text} data-tone={fact.tone}>
            <Icon name={fact.tone === "good" ? "check" : "close"} />
            <span>{fact.text}</span>
          </li>
        ))}
      </ul>
      <div className="pn-start-row pn-start-actions">
        <button type="button" className="pn-start-secondary" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="pn-start-primary"
          disabled={working}
          onClick={() => void proceed()}
        >
          Continue on this Mac
        </button>
      </div>
    </div>
  );
}

// ---- Idle -------------------------------------------------------------------

function Idle({
  s,
  host,
  member,
  say,
  onStarted,
}: {
  s: PanelSession;
  host: ReturnType<typeof accountHost>;
  member: ProductMember | null;
  say(text: string): void;
  onStarted(): void;
}) {
  const welcome = useMemo(() => takeWelcome(), []);
  const { state: choicesState } = useSetupChoices();
  const choices = choicesState.status === "ready" ? choicesState.choices : null;
  const targets = useMemo(
    () => startTargets(choices, member, Date.now()),
    [choices, member],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const target: StartTarget = targets.find((each) => each.id === picked) ??
    targets[0] ?? {
      id: "none",
      target: { kind: "rehearsal" },
      icon: "timer",
      title: "",
      sub: "",
      needsAgreement: false,
    };
  const [agreed, setAgreed] = useState(false);
  const permissions = usePermissions(host, true);
  const rows = permissionRows(permissions);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<SessionErrorCode | null>(null);
  const [consented, setConsented] = useState(shellConsented);
  useEffect(() => {
    if (consented) return;
    const timer = setInterval(() => setConsented(shellConsented()), 1_000);
    return () => clearInterval(timer);
  }, [consented]);
  const runId = useRef(newRehearsalRunId());

  const facts = {
    permissions,
    needsAgreement: target.needsAgreement,
    agreed,
    shellConsented: consented,
    starting,
    failure,
  };
  const block = startBlock(facts);
  const hint = startHint(facts);

  async function start() {
    if (block !== null) {
      say(block);
      return;
    }
    if (starting) return;
    setStarting(true);
    setFailure(null);
    const tenant = tenantFromLocation();
    const policy: LiveProcessingPolicy =
      loadHandsFreeChoice(tenant) ?? initialForm("mac").policy;
    const profiles = choices?.profiles ?? [];
    const request = buildStartRequest(
      {
        ...initialForm("mac"),
        policy,
        target: target.target,
        // Asked for on this screen when the target needs it (see startBlock).
        consent: true,
        matrix: defaultMatrix(profiles),
      },
      runId.current,
      profiles,
    );
    const result = request ? await s.actions.start(request) : null;
    if (result?.ok) {
      onStarted();
      return;
    }
    // Another window started one first: show that one instead.
    if (result && !result.ok && result.code === "open_session_exists") {
      const listed = await s.actions.listSessions();
      const running = listed.ok
        ? listed.sessions.find(
            (each) => each.status === "active" || each.status === "paused",
          )
        : undefined;
      if (running) {
        await s.actions.switchSession(running.id);
        return;
      }
    }
    setStarting(false);
    setFailure(result && !result.ok ? result.code : "invalid_input");
  }

  return (
    <div className="pn-start-body pn-start-idle">
      {welcome && (
        <p className="pn-start-banner" data-tone="good" role="status">
          <Icon name="check_circle" filled />
          {member?.kind === "local"
            ? "Using this Mac without an account"
            : member
              ? `Signed in as ${member.email}`
              : "Signed in"}
        </p>
      )}
      <section className="pn-start-group" aria-label="Start a session for">
        <h3 className="pn-start-label">START A SESSION FOR</h3>
        <div
          role="radiogroup"
          aria-label="Start a session for"
          className="pn-start-targets"
        >
          {targets.map((option) => {
            const on = option.id === target.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={on}
                className="pn-start-target"
                data-on={on ? "true" : undefined}
                onClick={() => setPicked(option.id)}
              >
                <Icon name={option.icon} />
                <span className="pn-start-target-text">
                  <span className="pn-start-target-title">{option.title}</span>
                  <span className="pn-start-target-sub">{option.sub}</span>
                </span>
                <Icon name="check" style={{ opacity: on ? 1 : 0 }} />
              </button>
            );
          })}
        </div>
      </section>
      {rows.length > 0 && (
        <section className="pn-start-group" aria-label="This Mac">
          <h3 className="pn-start-label">THIS MAC</h3>
          {rows.map((row) => (
            <PermissionLine key={row.id} row={row} />
          ))}
        </section>
      )}
      {target.needsAgreement && (
        <button
          type="button"
          role="checkbox"
          aria-checked={agreed}
          className="pn-start-agree"
          data-on={agreed ? "true" : undefined}
          onClick={() => setAgreed(!agreed)}
        >
          <StartIcon name={agreed ? "check_box" : "check_box_outline_blank"} />
          <span>{AGREEMENT_TEXT}</span>
        </button>
      )}
      <button
        type="button"
        className="pn-start-go"
        data-blocked={block !== null ? "true" : undefined}
        aria-disabled={block !== null || starting}
        onClick={() => void start()}
      >
        {starting ? (
          <span
            className="pn-start-spinner pn-start-spinner-light"
            aria-hidden="true"
          />
        ) : (
          <StartIcon name="radio_button_checked" />
        )}
        {starting ? "Starting…" : "Start session"}
      </button>
      <div className="pn-start-foot">
        <span
          className="pn-start-hint"
          data-testid="pn-start-hint"
          data-failed={failure ? "true" : undefined}
        >
          {hint}
        </span>
        {!consented && (
          <button
            type="button"
            className="pn-start-quiet"
            onClick={() => void openShellConsent()}
          >
            Review consent
          </button>
        )}
        <button
          type="button"
          className="pn-start-link"
          onClick={() => openExternalThroughHost(webStudioAddress())}
        >
          Set up in Studio on the web
        </button>
      </div>
    </div>
  );
}

function PermissionLine({ row }: { row: PermissionRow }) {
  const granted = row.state === "granted";
  const undetermined = row.state === "undetermined";
  return (
    <div className="pn-start-perm" data-state={row.state}>
      <Icon
        name={
          granted ? "check_circle" : undetermined ? "check_circle" : "error"
        }
        filled
      />
      <span className="pn-start-perm-label">{row.label}</span>
      {granted && <span className="pn-start-perm-state">Allowed</span>}
      {undetermined && (
        <span className="pn-start-perm-state">macOS asks when you start</span>
      )}
      {row.settings && (
        <button
          type="button"
          className="pn-start-chip pn-start-allow"
          onClick={() =>
            openExternalThroughHost(
              row.settings === "microphone"
                ? MICROPHONE_SETTINGS_URL
                : SCREEN_RECORDING_SETTINGS_URL,
            )
          }
        >
          Allow…
        </button>
      )}
    </div>
  );
}
