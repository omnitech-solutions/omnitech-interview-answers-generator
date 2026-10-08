// How this Mac captures the other side of the call (screen capture, or the
// system audio tap), read from the shell and changed through it. The shell
// owns the choice; a browser or an older shell has no such bridge member and
// this is null. Read again whenever `refresh` changes (a menu opening).
import {
  type AccountCallAudio,
  CALL_AUDIO_SOURCES,
  type CallAudioSource,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useState } from "react";
import { accountHost } from "./use-account";

export function useCallAudio(refresh: unknown): {
  callAudio: AccountCallAudio | null;
  choose(value: string): Promise<CallAudioSource | null>;
} {
  const host = accountHost();
  const [callAudio, setCallAudio] = useState<AccountCallAudio | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `refresh` asks for a fresh read
  useEffect(() => {
    if (!host?.setCallAudio) return;
    let live = true;
    host.permissions().then(
      (next) => live && setCallAudio(next.callAudio ?? null),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [host, refresh]);
  const choose = useCallback(
    async (value: string) => {
      const source = CALL_AUDIO_SOURCES.find((each) => each === value);
      if (!source || !host?.setCallAudio) return null;
      // The shell answers what now applies; a refusal leaves the choice as it was.
      const next = await host.setCallAudio(source);
      if (!next?.callAudio) return null;
      setCallAudio(next.callAudio);
      return next.callAudio.selected;
    },
    [host],
  );
  return { callAudio, choose };
}
