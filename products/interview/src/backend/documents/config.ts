// How documents are written, as settings rather than constants. Each has a
// default that suits a long template on Claude Code, and an environment
// variable that changes it for a deployment.

export type GenerationSettings = {
  // The most structured calls made at once for one document.
  maxCalls: number;
  // How many fields a call is worth: fewer fields than this share one call.
  fieldsPerCall: number;
  // Tries per call when the call itself fails (malformed output is never retried).
  attempts: number;
};

// How much the model is asked to write per field. Output length is what a
// document costs in time and money, so this is the main speed setting.
export type BrevitySettings = {
  fieldWords: number;
  listItemWords: number;
  summaryWords: number;
  skillItems: number;
};

export type DocumentsConfig = {
  generation: GenerationSettings;
  brevity: BrevitySettings;
};

export const DEFAULT_DOCUMENTS_CONFIG: DocumentsConfig = {
  generation: { maxCalls: 4, fieldsPerCall: 24, attempts: 2 },
  brevity: {
    fieldWords: 25,
    listItemWords: 15,
    summaryWords: 60,
    skillItems: 12,
  },
};

type Environment = Readonly<Record<string, string | undefined>>;

function whole(
  env: Environment,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return value;
}

/** The documents settings an environment asks for; a bad value is an error, not a guess. */
export function resolveDocumentsConfig(
  env: Environment = process.env,
): DocumentsConfig {
  const { generation, brevity } = DEFAULT_DOCUMENTS_CONFIG;
  return {
    generation: {
      maxCalls: whole(
        env,
        "DOCUMENTS_MAX_PARALLEL_CALLS",
        generation.maxCalls,
        1,
        8,
      ),
      fieldsPerCall: whole(
        env,
        "DOCUMENTS_FIELDS_PER_CALL",
        generation.fieldsPerCall,
        5,
        100,
      ),
      attempts: whole(
        env,
        "DOCUMENTS_CALL_ATTEMPTS",
        generation.attempts,
        1,
        3,
      ),
    },
    brevity: {
      fieldWords: whole(
        env,
        "DOCUMENTS_FIELD_WORDS",
        brevity.fieldWords,
        5,
        200,
      ),
      listItemWords: whole(
        env,
        "DOCUMENTS_LIST_ITEM_WORDS",
        brevity.listItemWords,
        3,
        100,
      ),
      summaryWords: whole(
        env,
        "DOCUMENTS_SUMMARY_WORDS",
        brevity.summaryWords,
        10,
        300,
      ),
      skillItems: whole(
        env,
        "DOCUMENTS_SKILL_ITEMS",
        brevity.skillItems,
        3,
        40,
      ),
    },
  };
}
