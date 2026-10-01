import { signIn } from "@/auth";

export default function SignInPage() {
  return (
    <main className="sign-in-page">
      <section>
        <p className="platform-eyebrow">Omnitech Studio</p>
        <h1>Continue to your product catalog</h1>
        <p>Use your organization identity to access your workspaces.</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/t/local" });
          }}
        >
          <button type="submit">Continue with Google</button>
        </form>
        <form
          action={async () => {
            "use server";
            await signIn("linkedin", { redirectTo: "/t/local" });
          }}
        >
          <button type="submit">Continue with LinkedIn</button>
        </form>
        {process.env["FAKE_AUTH_ENABLED"] === "true" ? (
          <form
            action={async () => {
              "use server";
              await signIn("local", { redirectTo: "/t/local" });
            }}
          >
            <button type="submit">Continue as local user</button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
