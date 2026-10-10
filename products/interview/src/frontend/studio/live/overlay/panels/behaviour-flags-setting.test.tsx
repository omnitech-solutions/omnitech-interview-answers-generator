// Settings › Behaviour: one control per flag in the registry, showing what the
// Studio says is in force, saved through the Studio's route, read-only when
// the host set the flag in the environment, and honest when a change failed.
import {
  BEHAVIOUR_FLAGS,
  type BehaviourFlagState,
} from "@omnitech/interview-contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BehaviourFlagsSetting,
  flagHelp,
  NOT_SAVED,
} from "./behaviour-flags-setting";

const VOICE = "ACTIVE_SESSION_VOICE_ACTIVITY";
const COACH = "INTERVIEW_COACH";
const RETAIN = "INTERVIEW_COACH_RETAIN";

const state = (
  changed: Partial<Record<string, Partial<BehaviourFlagState>>> = {},
): BehaviourFlagState[] =>
  BEHAVIOUR_FLAGS.map((flag) => ({
    key: flag.env,
    value: flag.default,
    source: "default" as const,
    stored: null,
    default: flag.default,
    ...changed[flag.env],
  }));

type Call = { method: string; tenant: string | null; body: unknown };

// A Studio that holds the flags: a PUT stores the change (unless told to
// refuse) and every answer is the whole list, as the real route's is.
function studio(
  initial: BehaviourFlagState[] | null,
  refuse: { status?: number; offline?: boolean } = {},
) {
  let flags = initial;
  const calls: Call[] = [];
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, tenant: headers.get("x-omnitech-tenant"), body });
    if (flags === null) return new Response("{}", { status: 401 });
    if (method === "PUT") {
      if (refuse.offline) throw new TypeError("fetch failed");
      if (refuse.status)
        return new Response(JSON.stringify({ error: { code: "refused" } }), {
          status: refuse.status,
        });
      const change = body as { key: string; value: string };
      flags = flags.map((flag) =>
        flag.key === change.key
          ? {
              ...flag,
              value: change.value,
              stored: change.value,
              source: "setting" as const,
            }
          : flag,
      );
    }
    return new Response(JSON.stringify({ flags }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  return { calls, fetcher };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Each flag is found the way a person and the control inventory find it: a
// button named by the flag's label, which shows the chosen value's name; its
// values are options once it is open.
const labelOf = (key: string) => {
  const flag = BEHAVIOUR_FLAGS.find((each) => each.env === key);
  if (!flag) throw new Error(`no flag ${key}`);
  return flag;
};
const control = (key: string) =>
  screen.findByRole("button", { name: labelOf(key).label });
const option = (key: string, value: string) =>
  screen.getByRole("option", {
    name:
      (labelOf(key).options as Readonly<Record<string, string>>)[value] ??
      value,
  });

describe("Settings › Behaviour", () => {
  it("shows nothing until the Studio has answered, and nothing when it refuses", async () => {
    studio(null);
    const { container } = render(<BehaviourFlagsSetting />);
    expect(container).toBeEmptyDOMElement();
    await Promise.resolve();
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when the Studio cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const { container } = render(<BehaviourFlagsSetting />);
    await Promise.resolve();
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it("reads the flags once, naming the window's tenant", async () => {
    const { calls } = studio(state());
    render(<BehaviourFlagsSetting />);
    await control(VOICE);
    expect(calls).toEqual([
      { method: "GET", tenant: "local", body: undefined },
    ]);
  });

  it("draws one control per flag in the registry, with its label, its value in force, every allowed value and its help", async () => {
    studio(state({ [COACH]: { value: "claude", source: "setting" } }));
    render(<BehaviourFlagsSetting />);
    expect(await screen.findByText("Behaviour")).toBeVisible();
    for (const flag of BEHAVIOUR_FLAGS) {
      const select = await control(flag.env);
      const shown = flag.env === COACH ? "claude" : flag.default;
      const options: Readonly<Record<string, string>> = flag.options;
      expect(select).toHaveTextContent(options[shown] as string);
      expect(screen.getByText(flag.label)).toBeVisible();
      expect(screen.getByText(flag.help)).toBeVisible();
      fireEvent.click(select);
      for (const value of flag.values)
        expect(option(flag.env, value)).toHaveTextContent(
          options[value] as string,
        );
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
    }
  });

  it("starts with voice activity off, no coach and one session kept", async () => {
    studio(state());
    render(<BehaviourFlagsSetting />);
    expect(await control(VOICE)).toHaveTextContent("Off");
    expect(await control(COACH)).toHaveTextContent("Off");
    expect(await control(RETAIN)).toHaveTextContent("On");
  });

  it("saves a change through the Studio and shows what the Studio answered", async () => {
    const { calls } = studio(state());
    render(<BehaviourFlagsSetting />);
    const select = await control(VOICE);
    fireEvent.click(select);
    fireEvent.click(option(VOICE, "on"));
    await waitFor(() => expect(select).toHaveTextContent("On"));
    expect(calls[1]).toEqual({
      method: "PUT",
      tenant: "local",
      body: { key: VOICE, value: "on" },
    });
    // The other flags are as they were.
    expect(await control(COACH)).toHaveTextContent("Off");
  });

  it("changes the coach to Codex and back off, one request each", async () => {
    const { calls } = studio(state());
    render(<BehaviourFlagsSetting />);
    const select = await control(COACH);
    fireEvent.click(select);
    fireEvent.click(option(COACH, "codex"));
    await waitFor(() => expect(select).toHaveTextContent("Codex"));
    fireEvent.click(select);
    fireEvent.click(option(COACH, "off"));
    await waitFor(() => expect(select).toHaveTextContent("Off"));
    expect(calls.slice(1).map((call) => call.body)).toEqual([
      { key: COACH, value: "codex" },
      { key: COACH, value: "off" },
    ]);
  });

  it("shows a flag the host set as it is, says the environment set it, and does not let it be changed", async () => {
    const { calls } = studio(
      state({ [COACH]: { value: "claude", source: "environment" } }),
    );
    render(<BehaviourFlagsSetting />);
    const select = await control(COACH);
    expect(select).toHaveTextContent("Claude Code");
    expect(select).toBeDisabled();
    expect(
      screen.getByText(/^Set by the environment \(INTERVIEW_COACH\)/),
    ).toBeVisible();
    fireEvent.click(select);
    expect(screen.queryByRole("option")).toBeNull();
    expect(calls).toHaveLength(1);
    // A flag the host did not set is still changed here.
    expect(await control(VOICE)).not.toBeDisabled();
  });

  it.each([
    ["the Studio refuses it", { status: 409 }],
    ["the Studio cannot be reached", { offline: true }],
  ])(
    "keeps the value on show and says it was not saved when %s",
    async (_name, refuse) => {
      const { calls } = studio(state(), refuse);
      render(<BehaviourFlagsSetting />);
      const select = await control(VOICE);
      fireEvent.click(select);
      fireEvent.click(option(VOICE, "on"));
      expect(await screen.findByText(NOT_SAVED)).toBeVisible();
      // The form is drawn again from what the Studio still holds.
      expect(await control(VOICE)).toHaveTextContent("Off");
      // Said for that flag only, under it.
      expect(screen.getAllByText(NOT_SAVED)).toHaveLength(1);
      expect(screen.getByText(NOT_SAVED).id).toContain(VOICE);
      // And it can be tried again: the next change is sent.
      fireEvent.click(await control(VOICE));
      fireEvent.click(option(VOICE, "on"));
      await waitFor(() =>
        expect(calls.filter((call) => call.method === "PUT")).toHaveLength(2),
      );
    },
  );

  // The library Select, unless it is searchable, does not yet take the arrow
  // keys once it is open (reported to the library): what the keyboard does
  // today is reach each flag in the registry's order, open it and leave it.
  it("is reached and opened from the keyboard, in the registry's order, and Escape leaves it unchanged", async () => {
    const user = userEvent.setup();
    const { calls } = studio(state());
    render(<BehaviourFlagsSetting />);
    await control(VOICE);
    for (const flag of BEHAVIOUR_FLAGS) {
      await user.tab();
      expect(await control(flag.env)).toHaveFocus();
    }
    const select = await control(COACH);
    select.focus();
    await user.keyboard("{Enter}");
    expect(select).toHaveAttribute("aria-expanded", "true");
    expect(option(COACH, "claude")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
    expect(select).toHaveTextContent("Off");
    expect(calls).toHaveLength(1);
  });

  it("puts who set a flag before what it does, only when the host set it", () => {
    for (const flag of BEHAVIOUR_FLAGS) {
      const [current] = state().filter((each) => each.key === flag.env);
      if (!current) throw new Error("no state");
      expect(flagHelp(flag, current)).toBe(flag.help);
      expect(flagHelp(flag, { ...current, source: "setting" })).toBe(flag.help);
      expect(flagHelp(flag, { ...current, source: "environment" })).toBe(
        `Set by the environment (${flag.env}); change it there. ${flag.help}`,
      );
    }
  });
});
