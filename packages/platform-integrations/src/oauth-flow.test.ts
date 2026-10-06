import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAuthorizationUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  type OAuthProviderConfiguration,
} from "./index";

// A stand-in OAuth provider: its token and userinfo endpoints answer from
// `provider`, and every request it receives is recorded.
type Endpoint = { status: number; body: unknown };
const provider: { token: Endpoint; profile: Endpoint } = {
  token: { status: 200, body: {} },
  profile: { status: 200, body: {} },
};
const received: { path: string; body: string; authorization?: string }[] = [];
let server: Server;
let configuration: OAuthProviderConfiguration;

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({
        path: request.url ?? "",
        body,
        ...(request.headers.authorization
          ? { authorization: request.headers.authorization }
          : {}),
      });
      const endpoint =
        request.url === "/token" ? provider.token : provider.profile;
      response.writeHead(endpoint.status, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(endpoint.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  configuration = {
    provider: "google",
    clientId: "client-1",
    clientSecret: "secret-1",
    authorizationUrl: `${origin}/authorize`,
    tokenUrl: `${origin}/token`,
    userInfoUrl: `${origin}/userinfo`,
    scopes: ["openid", "email"],
    pkce: false,
  };
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const redirectUri = "https://app.example.test/api/integrations/google/callback";

describe("OAuth authorization code flow", () => {
  it("sends the person to the provider with the client, scopes and state", () => {
    const url = new URL(
      createAuthorizationUrl(configuration, redirectUri, "signed-state"),
    );

    expect(url.pathname).toBe("/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: redirectUri,
      scope: "openid email",
      state: "signed-state",
      access_type: "offline",
      prompt: "consent",
    });
  });

  it("exchanges a code for tokens and the provider account", async () => {
    received.length = 0;
    provider.token = {
      status: 200,
      body: {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        scope: "openid email drive.file",
      },
    };
    provider.profile = { status: 200, body: { sub: "google-account-7" } };
    const before = Date.now();

    const grant = await exchangeAuthorizationCode(
      configuration,
      "code-1",
      redirectUri,
    );

    expect(grant).toMatchObject({
      providerAccountId: "google-account-7",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      scopes: ["openid", "email", "drive.file"],
    });
    expect(grant.expiresAt!.getTime()).toBeGreaterThanOrEqual(
      before + 3_600_000,
    );
    expect(Object.fromEntries(new URLSearchParams(received[0]!.body))).toEqual({
      grant_type: "authorization_code",
      code: "code-1",
      client_id: "client-1",
      client_secret: "secret-1",
      redirect_uri: redirectUri,
    });
    expect(received[1]).toMatchObject({
      path: "/userinfo",
      authorization: "Bearer access-1",
    });
  });

  it("falls back to the requested scopes when the provider omits them", async () => {
    provider.token = { status: 200, body: { access_token: "access-2" } };
    provider.profile = { status: 200, body: { sub: "account-8" } };

    const grant = await exchangeAuthorizationCode(
      configuration,
      "code-2",
      redirectUri,
    );

    expect(grant).toEqual({
      providerAccountId: "account-8",
      accessToken: "access-2",
      refreshToken: null,
      scopes: ["openid", "email"],
      expiresAt: null,
    });
  });

  it("fails when the provider rejects the code or withholds the profile", async () => {
    provider.token = { status: 400, body: { error: "invalid_grant" } };
    await expect(
      exchangeAuthorizationCode(configuration, "stale", redirectUri),
    ).rejects.toThrow("The provider rejected the OAuth grant.");

    provider.token = { status: 200, body: { access_token: "access-3" } };
    provider.profile = { status: 401, body: {} };
    await expect(
      exchangeAuthorizationCode(configuration, "code-3", redirectUri),
    ).rejects.toThrow("The provider profile could not be retrieved.");
  });
});

// RFC 9700 / RFC 7636: S256 PKCE binds the authorization code to the browser
// that started the attempt.
describe("PKCE", () => {
  it("creates a high-entropy verifier and its S256 challenge", () => {
    const first = createPkcePair();
    const second = createPkcePair();

    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).toBe(
      createHash("sha256").update(first.verifier).digest("base64url"),
    );
  });

  it("adds the challenge and the S256 method to the authorization request", () => {
    const url = new URL(
      createAuthorizationUrl(configuration, redirectUri, "s", "challenge-1"),
    );

    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain("verifier");
  });

  it("sends the verifier, never the challenge, on the token exchange", async () => {
    received.length = 0;
    provider.token = { status: 200, body: { access_token: "access-p" } };
    provider.profile = { status: 200, body: { sub: "account-p" } };

    await exchangeAuthorizationCode(
      { ...configuration, pkce: true },
      "code-p",
      redirectUri,
      "verifier-1",
    );

    const body = Object.fromEntries(new URLSearchParams(received[0]!.body));
    expect(body["code_verifier"]).toBe("verifier-1");
    expect(body).not.toHaveProperty("code_challenge");
  });

  it("refuses to exchange a code for a PKCE provider without the verifier", async () => {
    received.length = 0;

    await expect(
      exchangeAuthorizationCode(
        { ...configuration, pkce: true },
        "code-q",
        redirectUri,
      ),
    ).rejects.toThrow("The PKCE verifier is missing.");
    expect(received).toEqual([]);
  });

  it("lets the provider reject a wrong verifier", async () => {
    provider.token = { status: 400, body: { error: "invalid_grant" } };

    await expect(
      exchangeAuthorizationCode(
        { ...configuration, pkce: true },
        "code-r",
        redirectUri,
        "wrong-verifier",
      ),
    ).rejects.toThrow("The provider rejected the OAuth grant.");
  });

  it("omits the verifier for a provider without PKCE", async () => {
    received.length = 0;
    provider.token = { status: 200, body: { access_token: "access-s" } };
    provider.profile = { status: 200, body: { sub: "account-s" } };

    await exchangeAuthorizationCode(configuration, "code-s", redirectUri);

    expect(new URLSearchParams(received[0]!.body).has("code_verifier")).toBe(
      false,
    );
  });
});
