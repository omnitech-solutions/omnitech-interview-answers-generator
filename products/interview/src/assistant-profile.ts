// The interview product's identity and the AI profile its docked assistant
// runs on; the host configures which model serves the profile.
export const INTERVIEW_PRODUCT_ID = "omnitech.interview";
export const INTERVIEW_ASSISTANT_PROFILE = "interview-assistant";
// Generated interview answers and explanations: long structured replies
// (code, tests and the answer guide) that need a larger output budget than an
// assistant turn.
export const INTERVIEW_ANSWER_PROFILE = "interview-answers";
// Active Session assistance (ADR-0011 fast path). The fast profile serves
// permitted-remote sessions; the device profile is the only one a device-only
// session may use (rule:device-only-enforced-twice). The host declares each
// profile's locality in the shared profile configuration source; this product
// names profiles and never a provider or a model.
export const INTERVIEW_SESSION_FAST_PROFILE = "interview-session-fast";
export const INTERVIEW_SESSION_DEVICE_PROFILE = "interview-session-device";
