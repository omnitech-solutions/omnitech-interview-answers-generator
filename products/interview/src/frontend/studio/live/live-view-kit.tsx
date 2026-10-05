// Shared by the live view tests: a body rendered from the real derivation over
// synthetic fixtures, with spy actions.
import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { BannerHost } from "./banner-copy";
import { LiveSessionBody } from "./live-session-view";
import { action, minutesAfter, sessionView } from "./session-fixtures";
import type { SessionActions } from "./session-snapshot";
import { deriveLiveModel } from "./session-state";

export type Build = {
  session?: Parameters<typeof sessionView>[0];
  observations?: Parameters<typeof deriveLiveModel>[0]["observations"];
  actions?: Parameters<typeof deriveLiveModel>[0]["actions"];
  nowMinutes?: number;
};

export function build({
  session = {},
  observations = [],
  actions = [],
  nowMinutes = 2,
}: Build) {
  const view = sessionView({
    lastHeartbeatAt: minutesAfter(1, 55),
    ...session,
  });
  const model = deriveLiveModel({
    session: view,
    observations,
    actions,
    serverClockOffsetMs: 0,
    nowMs: Date.parse(minutesAfter(nowMinutes)),
  });
  return {
    view,
    model,
    stream: { actions, observations },
  };
}

export function spies() {
  const ok = async () => ({ ok: true as const });
  return {
    resume: vi.fn(ok),
    renewCredential: vi.fn(ok),
    tightenLocality: vi.fn(ok),
    shortenRetention: vi.fn(ok),
  };
}

export type Shown = {
  actions: ReturnType<typeof spies>;
  // Render again with new observations or actions (the stream moved on).
  again(next: Build): void;
};

export function show(
  input: Build,
  actions = spies(),
  host?: BannerHost,
): Shown {
  const { view, model, stream } = build(input);
  const ui = (v = view, m = model, st = stream) => (
    <LiveSessionBody
      session={v}
      model={m}
      stream={st}
      {...(host ? { host } : {})}
      actions={actions as unknown as SessionActions}
      busy={false}
      commandError={null}
      pairing={<div data-testid="pairing-slot" />}
    />
  );
  const utils = render(ui());
  return {
    actions,
    again(next: Build) {
      const built = build(next);
      utils.rerender(ui(built.view, built.model, built.stream));
    },
  };
}

export const answerAction = (result: unknown, overrides = {}) =>
  action({ actionKind: "draft-answer", result, ...overrides });
