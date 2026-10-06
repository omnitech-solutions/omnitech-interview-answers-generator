import type { ProductMember } from "@omnitech/platform-contracts";
import { useEffect, useState } from "react";
import { Icon } from "../icon";

// The one value this browser keeps about sign-in: the provider used last,
// shown as "Last used" on the sign-in page (which reads the same key).
const LAST_PROVIDER_KEY = "studio.last-provider";
const PARAM = "signed-in";

// "Signed in as <email>" once, right after a fresh sign-in. The sign-in lands
// on `?signed-in=<provider>`; this reads it, remembers the provider, removes it
// from the address (so a reload or a shared link never repeats it) and shows
// the banner until dismissed.
export function WelcomeBanner({ member }: { member: ProductMember }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    const provider = url.searchParams.get(PARAM);
    if (provider === null) return;
    url.searchParams.delete(PARAM);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    if (provider === "google" || provider === "linkedin") {
      try {
        window.localStorage.setItem(LAST_PROVIDER_KEY, provider);
      } catch {
        // Only the "Last used" chip is lost.
      }
    }
    setShown(true);
  }, []);
  if (!shown) return null;
  return (
    <div className="studio-welcome" role="status">
      <Icon name="check_circle" filled />
      <span>
        {member.kind === "local"
          ? "Continuing as local user on this computer"
          : `Signed in as ${member.email}`}
      </span>
      <button
        type="button"
        className="studio-icon-button"
        aria-label="Dismiss welcome message"
        onClick={() => setShown(false)}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
