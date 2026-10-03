// The platform's capture, behind the smallest possible port: start and stop
// named sources. Stopping is synchronous and needs no network, which is what
// lets a local stop work while Studio is down.
import type { CaptureSource } from "@omnitech/active-session-contracts";

export type CaptureDriver = {
  start(source: CaptureSource): void;
  stop(source: CaptureSource): void;
  stopAll(): void;
};
