import { AuthIcon } from "../auth-icon";

// What signing out did, in words that are true: it ends this browser's
// session only (a session cannot be revoked remotely), so the Mac app and
// other devices keep their own sign-in; a local user's data is untouched.
export function SignedOutView({ local }: { local: boolean }) {
  return (
    <main className="auth-page">
      <div className="auth-card auth-card-centered">
        <span className="auth-logo auth-logo-quiet" aria-hidden="true">
          <AuthIcon name="lock" />
        </span>
        <h1>You’re signed out</h1>
        <p>
          {local
            ? "Your local data is still on this computer."
            : "This browser is signed out. The Mac app and your other devices keep their own sign-in."}
        </p>
        <a className="auth-primary" href="/sign-in">
          Sign in again
        </a>
      </div>
    </main>
  );
}
