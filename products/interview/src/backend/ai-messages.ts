import { LIMITS, type ModelMessage } from "@omnitech/ai-engine";

// One text part holds a bounded number of characters; a longer text is sent
// as several parts of the same message, which a provider reads as one.
function textParts(text: string) {
  const parts: { type: "text"; text: string }[] = [];
  for (let start = 0; start < text.length; start += LIMITS.evidenceText)
    parts.push({
      type: "text",
      text: text.slice(start, start + LIMITS.evidenceText),
    });
  return parts;
}

/** A one-shot request as the engine takes it: the rules, then what to answer. */
export function promptMessages(system: string, prompt: string): ModelMessage[] {
  return [
    { role: "system", parts: textParts(system) },
    { role: "user", parts: textParts(prompt) },
  ];
}
