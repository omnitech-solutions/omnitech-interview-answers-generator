// The coding language list: only what the Active Session coding path generates
// today (LIVE_OWNER_LANGUAGES, the one definition) is selectable. The rest are
// listed so the person sees they are not forgotten, disabled.
import {
  LIVE_OWNER_LANGUAGE_LABELS,
  LIVE_OWNER_LANGUAGES,
  type LiveOwnerLanguage,
} from "@omnitech/interview-contracts";

export const NOT_SUPPORTED_YET = "not supported yet";
const UNSUPPORTED: readonly { value: string; label: string }[] = [
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "go", label: "Go" },
];

export type LanguageOption = {
  value: string;
  label: string;
  supported: boolean;
};

export const languageOptions = (): LanguageOption[] => [
  ...LIVE_OWNER_LANGUAGES.map((value) => ({
    value,
    label: LIVE_OWNER_LANGUAGE_LABELS[value],
    supported: true,
  })),
  ...UNSUPPORTED.map((each) => ({ ...each, supported: false })),
];

// The only way a select value becomes a language hint: a supported one.
export const supportedLanguage = (
  value: string,
): LiveOwnerLanguage | undefined =>
  LIVE_OWNER_LANGUAGES.find((each) => each === value);
