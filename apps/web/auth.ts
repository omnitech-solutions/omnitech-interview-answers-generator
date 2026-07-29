import {
  getPlatformDatabase,
  PlatformRepository,
} from "@omnitech/platform-storage";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import LinkedIn from "next-auth/providers/linkedin";

const providers = [];
const authSecret =
  process.env["AUTH_SECRET"] ??
  (process.env["NODE_ENV"] === "production"
    ? undefined
    : "development-only-auth-secret-change-before-deployment");

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
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  callbacks: {
    async signIn({ account, user }) {
      if (
        !process.env["DATABASE_URL"] ||
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
