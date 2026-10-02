import { Studio } from "@omnitech/product-interview/frontend";
import { createAssistantClient } from "@omnitech-assistant/sdk";
import React, { useMemo } from "react";

// The local assistant host: Interview Studio bound to the private workspace.
export function App() {
  const assistant = useMemo(
    () => ({
      client: createAssistantClient({ baseUrl: "/api/assistant/v1" }),
      workspaceId: "interview",
      profileId: "local-interview",
    }),
    [],
  );
  return <Studio assistant={assistant} />;
}
