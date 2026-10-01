import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "@omnitech/product-interview/frontend";
import { createAssistantClient } from "@omni-assistant/sdk";
import "../../web/app/styles.css";
import "./style.css";
function App() {
  const [artifact, setArtifact] = useState(
      new URLSearchParams(location.search).get("artifact") ?? "main",
    ),
    [next, setNext] = useState("");
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
        <button
          onClick={() => {
            if (!next.trim()) return;
            setArtifact(next.trim());
            history.replaceState(
              {},
              "",
              `/t/local/p/interview?artifact=${encodeURIComponent(next.trim())}`,
            );
          }}
        >
          Open question
        </button>
        <span>Current: {artifact}</span>
      </nav>
      <Workspace key={artifact} assistant={binding} />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
