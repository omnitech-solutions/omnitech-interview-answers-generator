import { Workspace } from "@omnitech/product-interview/frontend";
import { createAssistantClient } from "@omnitech-assistant/sdk";
import React, { useCallback, useMemo, useRef, useState } from "react";

export function App() {
  const [artifact, setArtifact] = useState(
    new URLSearchParams(location.search).get("artifact") ?? "main",
  );
  const [next, setNext] = useState("");
  const preparationDirty = useRef(false);
  const preparationChanged = useCallback((dirty: boolean) => {
    preparationDirty.current = dirty;
  }, []);
  const client = useMemo(
    () => createAssistantClient({ baseUrl: "/api/assistant/v1" }),
    [],
  );
  const binding = useMemo(
    () => ({
      client,
      workspaceId: "interview",
      artifactId: artifact,
      profileId: "local-interview",
    }),
    [client, artifact],
  );
  const openQuestion = () => {
    const target = next.trim();
    if (!target || target === artifact) return;
    if (
      preparationDirty.current &&
      !window.confirm(
        "Your interview preparation has unsaved changes. Discard them and open another question?",
      )
    )
      return;
    preparationDirty.current = false;
    setArtifact(target);
    history.replaceState(
      {},
      "",
      `/t/local/p/interview?artifact=${encodeURIComponent(target)}`,
    );
  };
  return (
    <>
      <nav className="assistant-app-nav">
        <strong>Omnitech Interview Studio</strong>
        <span>Local development · private PostgreSQL workspace</span>
        <label>
          Question identifier
          <input
            aria-label="Question identifier"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <button type="button" onClick={openQuestion}>
          Open question
        </button>
        <span>Current: {artifact}</span>
      </nav>
      <Workspace
        key={artifact}
        assistant={binding}
        onPreparationDirtyChange={preparationChanged}
      />
    </>
  );
}
