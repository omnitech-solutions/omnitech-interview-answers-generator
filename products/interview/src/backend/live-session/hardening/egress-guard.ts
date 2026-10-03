// A network-level egress guard for tests: while installed, any attempt to
// leave the machine - global fetch, http(s).request/get, or a TCP connect to a
// host that is not on the allow list - is recorded and refused with a thrown
// error. It is the safety net under spy adapters: a spy proves no adapter was
// called; this proves nothing ELSE reached the network on the path either.
// Tests, not production code, import this.
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";

export type EgressGuard = {
  // Every attempt to leave the process for a non-allowed destination.
  readonly blocked: string[];
  // Every destination the process connected to that WAS allowed.
  readonly allowed: string[];
  uninstall(): void;
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function installEgressGuard(
  extraAllowedHosts: string[] = [],
): EgressGuard {
  const allow = new Set([...LOOPBACK, ...extraAllowedHosts]);
  const blocked: string[] = [];
  const allowed: string[] = [];
  const restores: Array<() => void> = [];

  const check = (destination: string, kind: string): void => {
    if (allow.has(destination)) {
      allowed.push(`${kind} ${destination}`);
      return;
    }
    blocked.push(`${kind} ${destination}`);
    throw new Error(`egress blocked: ${kind} ${destination}`);
  };
  const hostOf = (input: unknown): string => {
    if (typeof input === "string") {
      try {
        return new URL(input).hostname;
      } catch {
        return input;
      }
    }
    if (input instanceof URL) return input.hostname;
    if (input && typeof input === "object") {
      const options = input as {
        host?: string;
        hostname?: string;
        url?: string;
      };
      return options.hostname ?? options.host ?? "unknown";
    }
    return "unknown";
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    // A Request object carries its own URL.
    const target =
      input && typeof input === "object" && "url" in input
        ? String((input as { url: string }).url)
        : input;
    check(hostOf(target), "fetch");
    return realFetch(input as never, init as never);
  }) as typeof fetch;
  restores.push(() => {
    globalThis.fetch = realFetch;
  });

  for (const [module, label] of [
    [http, "http"],
    [https, "https"],
  ] as const) {
    for (const method of ["request", "get"] as const) {
      const real = module[method] as (...args: unknown[]) => unknown;
      (module as unknown as Record<string, unknown>)[method] = (
        ...args: unknown[]
      ) => {
        check(hostOf(args[0]), `${label}.${method}`);
        return real.apply(module, args);
      };
      restores.push(() => {
        (module as unknown as Record<string, unknown>)[method] = real;
      });
    }
  }

  const realConnect = net.Socket.prototype.connect as (
    ...args: unknown[]
  ) => net.Socket;
  net.Socket.prototype.connect = function (
    this: net.Socket,
    ...args: unknown[]
  ) {
    // net.connect hands connect() its already-normalised [options, cb] array.
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const second = Array.isArray(args[0]) ? undefined : args[1];
    let host = "localhost";
    if (typeof first === "number") {
      // connect(port[, host])
      host = typeof second === "string" ? second : "localhost";
    } else if (first && typeof first === "object") {
      const options = first as { host?: string; path?: string };
      // A unix socket path never leaves the machine.
      host = options.path ? "localhost" : (options.host ?? "localhost");
    } else if (typeof first === "string") {
      host = "localhost";
    }
    check(host, "tcp");
    return realConnect.apply(this, args);
  } as typeof net.Socket.prototype.connect;
  restores.push(() => {
    net.Socket.prototype.connect = realConnect as never;
  });

  // Named ESM imports of the built-ins (import { request } from "node:http")
  // are snapshots until they are synchronised with the patched CJS exports.
  syncBuiltinESMExports();
  return {
    blocked,
    allowed,
    uninstall() {
      for (const restore of restores.splice(0).reverse()) restore();
      syncBuiltinESMExports();
    },
  };
}
