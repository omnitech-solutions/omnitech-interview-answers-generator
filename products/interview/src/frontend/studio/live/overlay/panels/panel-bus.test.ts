import { describe, expect, it } from "vitest";
import { openPanelBus } from "./panel-bus";

describe("panel bus", () => {
  it("keeps working after its last listener leaves (StrictMode re-run)", () => {
    const bus = openPanelBus();
    const stop = bus.listen(() => undefined);
    stop();
    // The channel was closed with the last listener; a later post must not throw.
    expect(() => bus.post({ type: "hello" })).not.toThrow();
    const again = bus.listen(() => undefined);
    expect(() => bus.post({ type: "hello" })).not.toThrow();
    again();
    expect(() => bus.post({ type: "hello" })).not.toThrow();
  });
});
