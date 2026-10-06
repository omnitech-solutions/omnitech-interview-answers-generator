"use client";

import type { ProductLink, ProductMember } from "@omnitech/platform-contracts";
import { createAssistantClient } from "@omnitech-assistant/sdk";
import { useEffect, useMemo, useState } from "react";
import { INTERVIEW_ASSISTANT_PROFILE } from "../../assistant-profile";
import { Studio } from "./studio";
import { studioFetch } from "./studio-fetch";

// Interview Studio as the platform mounts it: every interview route renders
// the whole studio, which routes within itself from the URL. It renders in
// the browser only, where that URL and the person's settings are known.
export function StudioPage({
  products = [],
}: {
  products?: readonly ProductLink[];
  // Who is signed in; the account menu reads it.
  member?: ProductMember;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const assistant = useMemo(
    () => ({
      client: createAssistantClient({
        baseUrl: "/api/assistant/v1",
        fetch: studioFetch,
      }),
      workspaceId: "interview",
      profileId: INTERVIEW_ASSISTANT_PROFILE,
    }),
    [],
  );
  return mounted ? <Studio assistant={assistant} products={products} /> : null;
}
