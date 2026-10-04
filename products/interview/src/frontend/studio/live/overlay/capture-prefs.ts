// What the person chose for capture, remembered per tenant in this browser:
// the region and the skill and coding language hints. localStorage is optional;
// every read and write is guarded, and nothing here is ever sent as storage.
import {
  LIVE_OWNER_LANGUAGES,
  LIVE_OWNER_SKILLS,
  type LiveOwnerLanguage,
  type LiveOwnerSkill,
} from "@omnitech/interview-contracts";
import { clampRect, FULL, type Rect } from "./mask-geometry";

const maskKey = (tenant: string) =>
  `interview-studio.live.capture-mask.${tenant}`;
// The companion's region is relative to the MAIN DISPLAY, not to a shared
// window, so it is remembered apart from the browser-share region.
const displayMaskKey = (tenant: string) =>
  `interview-studio.live.capture-display-mask.${tenant}`;
const settingsKey = (tenant: string) =>
  `interview-studio.live.capture-settings.${tenant}`;

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept for this page only.
  }
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function parseMask(raw: unknown): Rect {
  const stored = raw as Partial<Rect> | null;
  return finite(stored?.x) &&
    finite(stored?.y) &&
    finite(stored?.w) &&
    finite(stored?.h)
    ? clampRect({ x: stored.x, y: stored.y, w: stored.w, h: stored.h })
    : FULL;
}
export const loadMask = (tenant: string): Rect =>
  parseMask(read(maskKey(tenant)));
export const saveMask = (tenant: string, rect: Rect): void =>
  write(maskKey(tenant), rect);

export const loadDisplayMask = (tenant: string): Rect =>
  parseMask(read(displayMaskKey(tenant)));
export const saveDisplayMask = (tenant: string, rect: Rect): void =>
  write(displayMaskKey(tenant), rect);

export type CaptureSettings = {
  skill?: LiveOwnerSkill | undefined;
  language?: LiveOwnerLanguage | undefined;
};

export function loadSettings(tenant: string): CaptureSettings {
  const stored = read(settingsKey(tenant)) as {
    skill?: unknown;
    language?: unknown;
  } | null;
  const skill = LIVE_OWNER_SKILLS.find((value) => value === stored?.skill);
  const language = LIVE_OWNER_LANGUAGES.find(
    (value) => value === stored?.language,
  );
  return { ...(skill ? { skill } : {}), ...(language ? { language } : {}) };
}
export const saveSettings = (tenant: string, settings: CaptureSettings): void =>
  write(settingsKey(tenant), settings);
