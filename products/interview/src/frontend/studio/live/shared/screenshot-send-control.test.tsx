// The "Screenshots to the model" control, both variants, driven by the same hook
// both live surfaces use: radio semantics, one POST per change, the saved value
// shown, and every honest disabled or failed state.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionView as fixture } from "../testing/session-fixtures";
import {
  DEVICE_ONLY_REASON,
  ENDED_REASON,
  SAVE_FAILED_TEXT,
  SAVE_REFUSED_TEXT,
} from "./screenshot-send";
import {
  ScreenshotSendControl,
  type ScreenshotSendVariant,
} from "./screenshot-send-control";
import { useScreenshotSend } from "./use-screenshot-send";

afterEach(cleanup);

// The fixture's default policy is device-only; most cases want remote allowed.
const sessionView = (over: Parameters<typeof fixture>[0] = {}) =>
  fixture({ processingPolicy: "permitted-remote", ...over });

type Save = (
  value: string,
) => Promise<{ ok: true } | { ok: false; code: string }>;

function Harness({
  variant,
  session,
  save,
}: {
  variant: ScreenshotSendVariant;
  session: Parameters<typeof useScreenshotSend>[0]["session"];
  save: Save;
}) {
  // The "server": a successful save becomes the saved value on the session.
  const [record, setRecord] = useState(session);
  const send = useScreenshotSend({
    session: record,
    save: async (value) => {
      const result = await save(value);
      if (result.ok && record) setRecord({ ...record, screenshotSend: value });
      return result as never;
    },
  });
  return (
    <ScreenshotSendControl
      variant={variant}
      value={send.value}
      saving={send.saving}
      failure={send.failure}
      disabledReason={send.disabledReason}
      onChange={send.choose}
    />
  );
}

const ok: Save = async () => ({ ok: true });
const radio = (name: RegExp | string) =>
  screen.getByRole("radio", { name }) as HTMLInputElement;

describe.each(["native", "web"] as const)("%s", (variant) => {
  it("is a radio group named for the setting with the three options and their descriptions", () => {
    render(<Harness variant={variant} session={sessionView()} save={ok} />);
    const group = screen.getByRole("radiogroup", {
      name: "Screenshots to the model",
    });
    expect(group).toHaveClass(`ssc-${variant}`);
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).type)).toEqual([
      "radio",
      "radio",
      "radio",
    ]);
    // One shared name makes the arrow keys move between them natively.
    expect(new Set(radios.map((r) => (r as HTMLInputElement).name)).size).toBe(
      1,
    );
    expect(group).toHaveTextContent(
      "The screenshot image and the text read from it go to the model.",
    );
    expect(group).toHaveTextContent(
      "The image is dropped only when the text was read confidently and covers the screen and it is not code; otherwise the image goes too.",
    );
    expect(group).toHaveTextContent(
      "Only the text read from a screenshot goes to the model, when there is any.",
    );
  });

  it("shows the saved value, and Always when the session has none", () => {
    const { unmount } = render(
      <Harness variant={variant} session={sessionView()} save={ok} />,
    );
    expect(radio(/Always send/).checked).toBe(true);
    unmount();
    render(
      <Harness
        variant={variant}
        session={sessionView({ screenshotSend: "never" })}
        save={ok}
      />,
    );
    expect(radio(/Never send images/).checked).toBe(true);
    expect(radio(/Always send/).checked).toBe(false);
  });

  it("selecting an option saves once, shows Saving, then the saved value", async () => {
    let release: (() => void) | undefined;
    const save = vi.fn<Save>(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true });
        }),
    );
    render(<Harness variant={variant} session={sessionView()} save={save} />);
    fireEvent.click(radio(/Text only when the screen is just text/));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("text-only-when-text");
    expect(screen.getByTestId("screenshot-send-status")).toHaveTextContent(
      "Saving...",
    );
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-busy", "true");
    // No second request while one is out, whatever is pressed.
    expect(radio(/Never send images/)).toBeDisabled();
    fireEvent.click(radio(/Never send images/));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => release?.());
    expect(screen.queryByTestId("screenshot-send-status")).toBeNull();
    expect(radio(/Text only when the screen is just text/).checked).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("choosing the option already saved sends nothing", () => {
    const save = vi.fn<Save>(ok);
    render(<Harness variant={variant} session={sessionView()} save={save} />);
    fireEvent.click(radio(/Always send/));
    expect(save).not.toHaveBeenCalled();
  });

  it("a refused save says so and leaves the saved value showing", async () => {
    const save = vi.fn<Save>(async () => ({
      ok: false,
      code: "status_refused",
    }));
    render(
      <Harness
        variant={variant}
        session={sessionView({ screenshotSend: "always" })}
        save={save}
      />,
    );
    await act(async () => {
      fireEvent.click(radio(/Never send images/));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(SAVE_REFUSED_TEXT);
    expect(radio(/Always send/).checked).toBe(true);
    expect(radio(/Never send images/).checked).toBe(false);
  });

  it("any other failure says it did not save", async () => {
    const save = vi.fn<Save>(async () => ({ ok: false, code: "network" }));
    render(<Harness variant={variant} session={sessionView()} save={save} />);
    await act(async () => {
      fireEvent.click(radio(/Never send images/));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(SAVE_FAILED_TEXT);
    expect(radio(/Always send/).checked).toBe(true);
  });

  it("an ended session is disabled with the reason and posts nothing", () => {
    const save = vi.fn<Save>(ok);
    render(
      <Harness
        variant={variant}
        session={sessionView({ status: "ended", screenshotSend: "never" })}
        save={save}
      />,
    );
    for (const option of screen.getAllByRole("radio"))
      expect(option).toBeDisabled();
    expect(screen.getByTestId("screenshot-send-status")).toHaveTextContent(
      ENDED_REASON,
    );
    expect(screen.getByRole("radiogroup")).toHaveAccessibleDescription(
      ENDED_REASON,
    );
    fireEvent.click(radio(/Always send/));
    expect(save).not.toHaveBeenCalled();
    expect(radio(/Never send images/).checked).toBe(true);
  });

  it("a device-only session is disabled with the device-only reason", () => {
    const save = vi.fn<Save>(ok);
    render(
      <Harness
        variant={variant}
        session={sessionView({ processingPolicy: "device-only" })}
        save={save}
      />,
    );
    for (const option of screen.getAllByRole("radio"))
      expect(option).toBeDisabled();
    expect(screen.getByTestId("screenshot-send-status")).toHaveTextContent(
      DEVICE_ONLY_REASON,
    );
    expect(DEVICE_ONLY_REASON).toMatch(/ever sent/);
    fireEvent.click(radio(/Never send images/));
    expect(save).not.toHaveBeenCalled();
  });
});
