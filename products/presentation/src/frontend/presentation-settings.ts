import { safeStorage } from "./safe-storage";

// Shared with the platform shell, which writes the member's saved choice.
export const AI_PROFILE_KEY = "platform.aiProfileId";
export const CREATE_SETTINGS_KEY = "presentation.create-settings";
export const localStore = safeStorage("local");
export const sessionStore = safeStorage("session");

export function persistSelectedAiProfile(profileId: string) {
  localStore.set(AI_PROFILE_KEY, profileId);
  window.dispatchEvent(
    new CustomEvent("platform-ai-profile-change", {
      detail: { profileId },
    }),
  );
}
