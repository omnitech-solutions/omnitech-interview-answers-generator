// The windows' one view of the presentation: a host-independent consumer of
// the `PresentationHost` contract. A native shell supplies one
// (native-adapter), and a plain tab, an installed app or a PiP window a no-op.
// Views read `capabilities`, never which host this is.
import type {
  PresentationCapability,
  PresentationHost,
} from "@omnitech/interview-contracts";
import { nativePresentation } from "./native-adapter";

// The tab card and an ordinary browser window: nothing to open or move.
export const noopPresentation: PresentationHost = {
  capabilities: [],
  openSettings: async () => false,
  closeSettings: async () => false,
  setVisible: async () => false,
  interactionMode: () => true,
  setInteractionMode: async () => false,
  onInteractionMode: () => () => undefined,
};

// The host this document is in: the native one when the shell offers it,
// otherwise the no-op.
export function selectPresentation(): PresentationHost {
  return nativePresentation() ?? noopPresentation;
}

export const hasCapability = (
  host: PresentationHost,
  capability: PresentationCapability,
): boolean => host.capabilities.includes(capability);
