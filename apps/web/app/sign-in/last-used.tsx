"use client";

import { useEffect, useState } from "react";

export const LAST_PROVIDER_KEY = "studio.last-provider";

// "Last used", from the one value the app stores after a successful sign-in.
// It reads on mount, so the server-rendered page and the first client render
// agree; storage can be unavailable, and then there is simply no chip.
export function LastUsed({ provider }: { provider: "google" | "linkedin" }) {
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    try {
      setLast(window.localStorage.getItem(LAST_PROVIDER_KEY));
    } catch {
      setLast(null);
    }
  }, []);
  return last === provider ? (
    <span className="auth-last-used">Last used</span>
  ) : null;
}
