// The banners above the session: one line each, full width, in the model's
// priority order. A red one is an alert (it interrupts), an amber one a status.
// The sentence comes from banner-copy.ts; the button does what the copy says.
import { Icon, type IconName } from "../icon";
import { type BannerAction, bannerCopy } from "./banner-copy";
import type { BannerKind } from "./session-banners";
import type { LiveViewModel } from "./session-state";

const BANNER_ICON: Record<BannerKind, IconName> = {
  "stream-unreachable": "wifi_off",
  paused: "pause_circle",
  "permission-revoked": "lock",
  "source-lost": "error",
  gap: "warning",
  "credential-expired": "lock",
  "credential-revoked": "lock",
  "credential-expiring": "timer",
  "cap-near": "timer",
  "cap-reached": "timer",
};

export function SessionBanners({
  model,
  busy,
  onAction,
}: {
  model: LiveViewModel;
  // A command is in flight: its button waits.
  busy: boolean;
  onAction(action: BannerAction): void;
}) {
  if (model.banners.length === 0) return null;
  return (
    <div className="live-banners">
      {model.banners.map((banner) => {
        const copy = bannerCopy(banner, model);
        return (
          <div
            key={`${banner.kind}-${banner.source ?? ""}`}
            className={`live-banner ${banner.tone}`}
            role={banner.tone === "red" ? "alert" : "status"}
            data-banner={banner.kind}
          >
            <Icon name={BANNER_ICON[banner.kind]} />
            <span className="live-banner-text">
              <strong>{copy.title}</strong> {copy.detail}
            </span>
            {copy.action && (
              <button
                type="button"
                className="live-banner-action"
                disabled={busy}
                onClick={() => onAction(copy.action as BannerAction)}
              >
                {copy.actionLabel}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
