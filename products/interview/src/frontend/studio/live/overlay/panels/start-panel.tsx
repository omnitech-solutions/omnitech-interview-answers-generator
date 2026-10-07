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

import {
  ActionMenu,
  type ActionMenuItem,
  Button,
  Checkbox,
  Empty,
  Panel,
  Segmented,
  Tag,
} from "@oc-tech/omni-ui-components";
import type {
  AccountProvider,
  LiveProcessingPolicy,
  PresentationHost,
} from "@omnitech/interview-contracts";
import type { ProductMember } from "@omnitech/platform-contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { usePortalRoot } from "./portal-root";
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
// After Try again found nothing to reconnect to: the one thing left to do.
const GONE_FOR_GOOD_TEXT =
  "Nothing to reconnect to: that session has ended. Start a new session below.";

export function StartPanel(props: StartPanelProps) {
  const { s, controls, signedIn, member } = props;
  const host = useMemo(() => accountHost(), []);
  const signIn = useSignInState(host);
  const [confirmingLocal, setConfirmingLocal] = useState(false);
  // Try again on the gone-session banner: a visible check, then the truth.
  const [reconnect, setReconnect] = useState<"idle" | "checking" | "nothing">(
    "idle",
  );
  const tryAgain = async () => {
    setReconnect("checking");
    await s.actions.refresh();
    // Still on the start screen after the refresh: there is nothing to open.
    setReconnect("nothing");
    document
      .querySelector<HTMLElement>('[data-testid="pn-start-session"]')
      ?.focus();
  };
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
                <Tag data-testid="pn-chip-out">
                  <StartIcon name="person_off" />
                  Not signed in
                </Tag>
              )}
            </>
          }
        />
      </ToolbarLock.Provider>
      {/* `pn-start-card` is the hit region the native shell reads, not a style. */}
      <Panel
        className="pn-start-card"
        data-testid="pn-start"
        data-stage={stage}
        title={STAGE_TITLE[stage]}
        bodyClassName="pn-start-scroll"
      >
        {props.notice === "unavailable" && stage === "idle" && (
          <p
            className="pn-start-banner"
            data-tone="warn"
            role="status"
            data-testid="pn-gone-banner"
            data-reconnect={reconnect}
          >
            <Icon name="warning" />
            <span>
              {reconnect === "nothing" ? GONE_FOR_GOOD_TEXT : GONE_TEXT}
            </span>
            {reconnect !== "nothing" && (
              <Button
                buttonSize="sm"
                variant="outline"
                disabled={reconnect === "checking"}
                onClick={() => void tryAgain()}
              >
                {reconnect === "checking" ? "Checking…" : "Try again"}
              </Button>
            )}
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
      </Panel>
      <div className="pn-single-foot" data-drag-handle="">
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
  const portal = usePortalRoot();
  if (!member)
    return (
      <Tag data-testid="pn-chip">
        <Icon name="check_circle" />
        Signed in
      </Tag>
    );
  const chip = chipOf(member);
  const lines = accountLines(member);
  // A development Studio signs every request in as the local owner: there is
  // no session to end, so no sign-out is drawn.
  const signOutShown = member.canSignOut && canSignOut;
  const items: ActionMenuItem[] = [
    {
      id: "web",
      label: "Open Studio on the web",
      icon: <Icon name="open_in_new" />,
      onSelect: () => openExternalThroughHost(webStudioAddress()),
    },
    {
      id: "settings",
      label: "Settings",
      icon: <Icon name="settings" />,
      onSelect: () => void presentation.openSettings(),
    },
    ...(member.kind === "local" && signOutShown
      ? [
          {
            id: "sign-in",
            label: "Sign in with Google or LinkedIn",
            icon: <Icon name="link" />,
            onSelect: onSignOut,
          },
        ]
      : []),
    ...(signOutShown
      ? [
          {
            id: "sign-out",
            label: signOutLabel(member),
            icon: <StartIcon name="logout" />,
            tone: "danger" as const,
            onSelect: onSignOut,
          },
        ]
      : []),
  ];
  return (
    <ActionMenu
      label="Account"
      title={lines.name}
      sections={[{ id: "account", label: lines.via, items }]}
      align="end"
      width={250}
      container={portal.container}
      trigger={
        <Button
          ref={portal.ref}
          variant="ghost"
          buttonSize="control"
          aria-label={`Account: ${chip.short}`}
          title="Account"
          data-testid="pn-chip"
          icon={
            <span className="pn-chip-initial" data-kind={member.kind}>
              {chip.initial}
            </span>
          }
          iconAfter={<Icon name="expand_more" />}
        >
          {chip.short}
        </Button>
      }
    />
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
          <Button variant="ghost" buttonSize="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      )}
      {host && ready && (
        <div className="pn-start-stack">
          <Button
            variant="outline"
            buttonSize="control"
            className="pn-start-wide"
            data-provider="google"
            disabled={!ready.google}
            icon={
              <span
                className="pn-start-mark pn-start-mark-g"
                aria-hidden="true"
              >
                G
              </span>
            }
            onClick={() => void begin("google")}
          >
            Continue with Google
          </Button>
          <Button
            variant="outline"
            buttonSize="control"
            className="pn-start-wide"
            data-provider="linkedin"
            disabled={!ready.linkedin}
            icon={
              <span
                className="pn-start-mark pn-start-mark-in"
                aria-hidden="true"
              >
                in
              </span>
            }
            onClick={() => void begin("linkedin")}
          >
            Continue with LinkedIn
          </Button>
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
        <Button
          variant="outline"
          buttonSize="control"
          className="pn-start-wide"
          data-testid="pn-start-local"
          icon={<StartIcon name="laptop_mac" />}
          onClick={onLocal}
        >
          Continue on this Mac, no account
        </Button>
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
    <Empty
      variant="tile"
      className="pn-start-body pn-start-waiting"
      icon={<span className="pn-start-spinner" />}
      title={
        <h2 className="pn-start-h pn-start-tile-h">
          Finish signing in in your browser
        </h2>
      }
      description={`We opened ${PROVIDER_NAME[provider]} in your default browser. This window updates by itself when you’re done.`}
    >
      <div className="pn-start-row">
        <Button
          variant="outline"
          buttonSize="sm"
          icon={<Icon name="open_in_new" />}
          onClick={() => void host?.reopenSignIn()}
        >
          Open browser again
        </Button>
        <Button
          variant="outline"
          buttonSize="sm"
          icon={<Icon name="link" />}
          onClick={() =>
            void host
              ?.copySignInLink()
              .then((copied) =>
                say(copied ? "Sign-in link copied" : "Couldn’t copy the link"),
              )
          }
        >
          Copy link
        </Button>
      </div>
      <Button
        variant="ghost"
        buttonSize="sm"
        onClick={() => void host?.cancelSignIn()}
      >
        Cancel
      </Button>
    </Empty>
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
        <Button variant="outline" buttonSize="control" onClick={onBack}>
          Back
        </Button>
        <Button
          buttonSize="control"
          disabled={working}
          onClick={() => void proceed()}
        >
          Continue on this Mac
        </Button>
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
        <Segmented
          label="Start a session for"
          appearance="control"
          value={target.id}
          onChange={setPicked}
          options={targets.map((option) => ({
            value: option.id,
            label: option.title,
            icon: <Icon name={option.icon} />,
          }))}
        />
        <p className="pn-start-target-sub">{target.sub}</p>
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
        <Checkbox
          label={AGREEMENT_TEXT}
          checked={agreed}
          onChange={setAgreed}
        />
      )}
      <Button
        tone="danger"
        buttonSize="control-labelled"
        className="pn-start-go"
        loading={starting}
        aria-disabled={block !== null || starting}
        icon={<StartIcon name="radio_button_checked" />}
        data-testid="pn-start-session"
        onClick={() => void start()}
      >
        {starting ? "Starting…" : "Start session"}
      </Button>
      <div className="pn-start-foot">
        <span
          className="pn-start-hint"
          data-testid="pn-start-hint"
          data-failed={failure ? "true" : undefined}
        >
          {hint}
        </span>
        {!consented && (
          <Button
            variant="ghost"
            buttonSize="sm"
            onClick={() => void openShellConsent()}
          >
            Review consent
          </Button>
        )}
        <Button
          variant="link"
          buttonSize="sm"
          onClick={() => openExternalThroughHost(webStudioAddress())}
        >
          Set up in Studio on the web
        </Button>
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
        <Button
          variant="outline"
          buttonSize="sm"
          onClick={() =>
            openExternalThroughHost(
              row.settings === "microphone"
                ? MICROPHONE_SETTINGS_URL
                : SCREEN_RECORDING_SETTINGS_URL,
            )
          }
        >
          Allow…
        </Button>
      )}
    </div>
  );
}
