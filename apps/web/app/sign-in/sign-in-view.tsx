import { AuthIcon } from "../auth-icon";
import { signInWith } from "./actions";
import { LastUsed } from "./last-used";

export type SignInViewProps = {
  // A validated same-origin target and its name; the banner is true only then.
  next: string | null;
  nextLabel: string | null;
  expired: boolean;
  providers: { google: boolean; linkedin: boolean };
  // Offered only where Studio really runs on this computer.
  localAvailable: boolean;
};

function ProviderButton({
  provider,
  label,
  mark,
  configured,
  next,
}: {
  provider: "google" | "linkedin";
  label: string;
  mark: string;
  configured: boolean;
  next: string | null;
}) {
  return (
    <form action={signInWith}>
      <input type="hidden" name="provider" value={provider} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <button
        type="submit"
        className={`auth-button auth-${provider}`}
        disabled={!configured}
        title={configured ? undefined : `${label} sign-in is not set up here`}
      >
        <span className="auth-mark" aria-hidden="true">
          {mark}
        </span>
        Continue with {label}
        {configured ? <LastUsed provider={provider} /> : null}
      </button>
      {configured ? null : (
        <p className="auth-note" role="note">
          {label} sign-in is not set up on this Studio.
        </p>
      )}
    </form>
  );
}

// The login page: dark by default, light when the system asks. It shows only
// what works: a provider that is not configured is disabled with its reason,
// and "Continue as local user" is absent unless the server offers it.
export function SignInView({
  next,
  nextLabel,
  expired,
  providers,
  localAvailable,
}: SignInViewProps) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <header className="auth-head">
          <span className="auth-logo" aria-hidden="true">
            <AuthIcon name="forum" />
          </span>
          <h1>{expired ? "Welcome back" : "Sign in to Interview Studio"}</h1>
          <p>
            {expired
              ? "Sign in to continue."
              : "Prepare, rehearse and get live help in developer interviews."}
          </p>
        </header>
        {next && nextLabel && !expired ? (
          <p className="auth-banner auth-banner-info" role="status">
            <AuthIcon name="sensors" />
            <span>
              You’ll go back to <b>{nextLabel}</b> after signing in
            </span>
          </p>
        ) : null}
        {expired ? (
          <p className="auth-banner auth-banner-warn" role="status">
            <AuthIcon name="schedule" />
            <span>
              Your sign-in expired. Sign in again to pick up where you left off.
            </span>
          </p>
        ) : null}
        <div className="auth-providers">
          <ProviderButton
            provider="google"
            label="Google"
            mark="G"
            configured={providers.google}
            next={next}
          />
          <ProviderButton
            provider="linkedin"
            label="LinkedIn"
            mark="in"
            configured={providers.linkedin}
            next={next}
          />
        </div>
        {localAvailable ? (
          <>
            {/* biome-ignore lint/a11y/useAriaPropsForRole: a static divider: the value attributes belong to a separator that can be moved */}
            {/* biome-ignore lint/a11y/useSemanticElements: the divider holds visible text and its own styling, which an hr cannot */}
            {/* biome-ignore lint/a11y/useFocusableInteractive: a static divider that cannot be moved, so it takes no focus */}
            <div className="auth-or" role="separator">
              <span>or</span>
            </div>
            <form action={signInWith} className="auth-local">
              <input type="hidden" name="provider" value="local" />
              {next ? <input type="hidden" name="next" value={next} /> : null}
              <button type="submit" className="auth-button auth-local-button">
                <AuthIcon name="desktop_windows" />
                Continue as local user
              </button>
              <p className="auth-note">
                Shown because Studio is running on this computer. No account or
                password; data stays here.
              </p>
            </form>
          </>
        ) : null}
        <p className="auth-footnote">
          We only receive your name, email and photo. Studio never sees your
          password.
        </p>
      </div>
    </main>
  );
}
