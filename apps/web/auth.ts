import "@/src/platform/server-only";
import { getPlatformDatabase } from "@omnitech/database";
import { PlatformRepository } from "@omnitech/platform-storage";
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import LinkedIn from "next-auth/providers/linkedin";

import {
  resolveAuthSecret,
  resolveTrustHost,
} from "@/src/platform/auth-settings";
import { allowLocalSignIn, LOCAL_USER_EMAIL } from "@/src/platform/fake-auth";

const providers: Provider[] = [
  ...(process.env["FAKE_AUTH_ENABLED"] === "true"
    ? [
        Credentials({
          id: "local",
          name: "Local development",
          credentials: {},
          // [SAFETY] Passwordless, so only where Studio runs on this computer.
          authorize: async (_credentials, request) =>
            allowLocalSignIn(request?.headers)
              ? {
                  id: "00000000-0000-4000-8000-000000000001",
                  name: "Local User",
                  email: LOCAL_USER_EMAIL,
                }
              : null,
        }),
      ]
    : []),
];
const authSecret = resolveAuthSecret();

// The session cookie's name, for the native handoff redemption, which sets
// the same cookie Auth.js would (it is also the JWT salt).
export function sessionCookieName(secure: boolean): string {
  if (process.env["NODE_ENV"] !== "production") return "omnitech.dev-session";
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}
export { authSecret };

if (process.env["AUTH_GOOGLE_ID"] && process.env["AUTH_GOOGLE_SECRET"]) {
  providers.push(
    Google({
      clientId: process.env["AUTH_GOOGLE_ID"],
      clientSecret: process.env["AUTH_GOOGLE_SECRET"],
    }),
  );
}

if (process.env["AUTH_LINKEDIN_ID"] && process.env["AUTH_LINKEDIN_SECRET"]) {
  providers.push(
    LinkedIn({
      clientId: process.env["AUTH_LINKEDIN_ID"],
      clientSecret: process.env["AUTH_LINKEDIN_SECRET"],
    }),
  );
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers,
  ...(authSecret ? { secret: authSecret } : {}),
  ...(process.env["NODE_ENV"] === "production"
    ? {}
    : {
        // Development sessions never share production's cookie.
        cookies: { sessionToken: { name: "omnitech.dev-session" } },
      }),
  trustHost: resolveTrustHost(),
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  callbacks: {
    async signIn({ account, user }) {
      if (
        !account ||
        !user.email ||
        (account.provider !== "google" && account.provider !== "linkedin")
      ) {
        return true;
      }
      const repository = new PlatformRepository(getPlatformDatabase());
      await repository.upsertIdentity({
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        email: user.email,
        displayName: user.name ?? user.email,
        avatarUrl: user.image ?? null,
      });
      return true;
    },
  },
});
