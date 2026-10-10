// A written interview call, rendered as a recorder would have heard it.
//
// PROBLEM: a held-out benchmark needs a transcript of a long call (80 minutes,
// thousands of fragments) whose every question and answer is known, and a
// recording of a real one cannot be kept. Writing 5,000 lines of recorder
// output by hand is neither reviewable nor repeatable.
// STRATEGY: the call is WRITTEN as prose (who asks what, what the candidate
// answers), and `renderCall` cuts that prose the way a recorder does: short
// fragments, each with its own clock, disfluencies, dropped capitals and
// punctuation, mis-heard terms, back-channels from the other speaker and a
// label the recorder sometimes loses. Everything random comes from one seeded
// generator, so the same scenario always gives the same bytes.
// COMPLEXITY: O(words) in time and space.
//
// [DOMAIN] The format is the recorder's: "HH:MM:SS --> HH:MM:SS", then
// "Label: text", then a blank line (brief/transcript.ts reads it).

export type CallTurn = [label: string, text: string];

export type CallFollowUp = { ask: string; answer: string };

export type CallExchange = {
  id: string;
  // The label of the interviewer who asks.
  from: string;
  // The question as written, with whatever the interviewer says before it.
  ask: string;
  // The candidate's answer as written.
  answer: string;
  followUps?: CallFollowUp[];
  // How many times an interviewer cuts into the answer.
  interruptions?: number;
  // The matrix employers the answer draws on.
  evidence?: string[];
  about?: string[];
};

export type CallScenario = {
  seed: number;
  startsAt: string;
  people: Record<string, { part: "interviewer" | "me"; who: string }>;
  // A term and what a recorder writes instead of it, some of the time.
  misheard: Record<string, string[]>;
  // How often a term is mis-heard (MISHEARD_PROBABILITY when absent).
  misheardProbability?: number;
  // Scripted mini-exchanges that are no question for the candidate.
  fillers: {
    smallTalk: CallTurn[][];
    logistics: CallTurn[][];
    tangents: CallTurn[][];
  };
  exchanges: CallExchange[];
  // Fillers are interleaved until the call has this many fragments.
  targetFragments: number;
};

export type CallQuestion = {
  id: string;
  from: string;
  // The last words of the question AS RENDERED: before them it is not whole.
  completeWhenSaid: string;
  // The clock of the question's first fragment, and of the end of its last.
  startsAt: string;
  endsAt: string;
  evidence: string[];
  about: string[];
};

// A term in `misheard` is replaced this often, so both forms occur.
export const MISHEARD_PROBABILITY = 0.45;

const WORDS_PER_SECOND = 2.5;
const UNKNOWN = "Unknown";
const HESITATIONS = [
  "um,",
  "uh,",
  "so,",
  "you know,",
  "like,",
  "I mean,",
  "kind of,",
  "um…",
  "uh…",
  "right, so,",
];
const FALSE_STARTS = [
  "what are…",
  "so how…",
  "I guess what…",
  "can you…",
  "so, um…",
  "how do…",
];
const BACK_CHANNELS = ["mm-hm", "right", "yeah", "okay", "sure", "mm", "yep"];
const CUT_INS = [
  "sorry, just to cut in for a second, you froze there, go on",
  "sorry, one sec, somebody is at my door… okay, carry on",
  "sorry to jump in, keep going, I just lost the audio for a moment",
  "hang on, sorry, my screen went… no, you're back, go ahead",
  "sorry, can you just say that last bit again",
];
const RESUMES = [
  "yeah, so,",
  "sure, so as I was saying,",
  "no problem, so,",
  "yeah, where was I, so,",
  "okay, so,",
];

type Random = () => number;

// A small seeded generator (mulberry32): no Math.random, no clock.
function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const below = (random: Random, limit: number) => Math.floor(random() * limit);
const between = (random: Random, low: number, high: number) =>
  low + random() * (high - low);
function pick<Each>(random: Random, from: readonly Each[]): Each {
  return from[below(random, from.length)] as Each;
}

type Fragment = {
  label: string;
  text: string;
  // Who was really speaking, whatever label the recorder gave.
  speaker: string;
  // A longer silence before it: someone thinking, or a turn handed over.
  pause?: number;
};

const escaped = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ENDS_CLAUSE = /[,.;:?!…]$/;
const ENDS_SENTENCE = /[.?!…]$/;

// Each occurrence of a term is replaced with the stated probability; longer
// terms first, so "FHIR R4" is tried before "FHIR".
function mishear(text: string, scenario: CallScenario, random: Random): string {
  const rate = scenario.misheardProbability ?? MISHEARD_PROBABILITY;
  let heard = text;
  const terms = Object.keys(scenario.misheard).sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  );
  for (const term of terms) {
    const forms = scenario.misheard[term] ?? [];
    if (forms.length === 0) continue;
    const whole = new RegExp(
      `(?<![A-Za-z0-9])${escaped(term)}(?![A-Za-z0-9])`,
      "gi",
    );
    heard = heard.replace(whole, (found) =>
      random() < rate ? pick(random, forms) : found,
    );
  }
  return heard;
}

// How many words the next fragment takes: mostly a few, sometimes one,
// sometimes a whole clause of up to fourteen.
function fragmentSize(random: Random): number {
  const roll = random();
  if (roll < 0.1) return 1 + below(random, 2);
  if (roll < 0.42) return 3 + below(random, 4);
  if (roll < 0.8) return 7 + below(random, 4);
  return 11 + below(random, 4);
}

// Words as fragments of 1 to 14 words, cut after a comma or a full stop where
// one is near: a recorder closes a fragment when the speaker draws breath.
function cut(words: readonly string[], random: Random): string[][] {
  const chunks: string[][] = [];
  let at = 0;
  while (at < words.length) {
    let size = Math.min(fragmentSize(random), words.length - at);
    if (random() < 0.5)
      for (let back = size; back >= 3; back -= 1)
        if (ENDS_CLAUSE.test(words[at + back - 1] ?? "")) {
          size = back;
          break;
        }
    chunks.push(words.slice(at, at + size));
    at += size;
  }
  return chunks;
}

// Capitals and punctuation as a recorder leaves them: a sentence's capital is
// sometimes lost, a mid-sentence fragment sometimes gains one, and the mark at
// the end of a fragment comes and goes.
function roughen(
  chunk: readonly string[],
  opensSentence: boolean,
  random: Random,
): string {
  let text = chunk.join(" ");
  const first = chunk[0] ?? "";
  const keepsCapital = /^(I|I'[a-z]+)$/.test(first) || /^[A-Z]{2,}/.test(first);
  if (opensSentence && !keepsCapital && random() < 0.3)
    text = text.charAt(0).toLowerCase() + text.slice(1);
  else if (!opensSentence && random() < 0.07)
    text = text.charAt(0).toUpperCase() + text.slice(1);
  const roll = random();
  if (/[,.;:]$/.test(text)) {
    if (roll < 0.3) text = text.slice(0, -1);
    else if (roll < 0.36) text = `${text.slice(0, -1)}…`;
  } else if (!ENDS_CLAUSE.test(text) && roll < 0.3) text = `${text},`;
  return text;
}

type Speech = {
  label: string;
  text: string;
  // The other side of the conversation: who says "mm-hm" while this one talks.
  other?: string;
  question?: boolean;
  interviewer?: boolean;
  cutIns?: { by: string; times: number };
};

// One speech as fragments. A question's last few words are one clean fragment
// of the asker's, so the words that complete it are found as they are.
function speak(
  speech: Speech,
  scenario: CallScenario,
  random: Random,
): { fragments: Fragment[]; tail: number } {
  const words = mishear(speech.text, scenario, random)
    .split(/\s+/)
    .filter((word) => word !== "");
  const tailSize = speech.question
    ? Math.min(words.length, 5 + below(random, 3))
    : 0;
  const body = cut(words.slice(0, words.length - tailSize), random);
  const fragments: Fragment[] = [];
  const say = (text: string, label = speech.label, pause?: number) =>
    fragments.push({
      label,
      text,
      speaker: label === UNKNOWN ? speech.label : label,
      ...(pause === undefined ? {} : { pause }),
    });
  // Where an interviewer cuts in: somewhere in the middle of the answer.
  const cutAt = new Set<number>();
  if (speech.cutIns && body.length >= 8)
    for (let made = 0; made < speech.cutIns.times; made += 1)
      cutAt.add(
        Math.floor(body.length * between(random, 0.25, 0.8)) +
          (cutAt.size > 0 ? 1 : 0),
      );
  const hesitates = speech.interviewer ? 0.08 : 0.13;
  if (speech.question && random() < 0.3) say(pick(random, FALSE_STARTS));
  let opensSentence = true;
  for (const [at, chunk] of body.entries()) {
    if (speech.cutIns && cutAt.has(at)) {
      say(pick(random, CUT_INS), speech.cutIns.by, between(random, 0.2, 0.9));
      say(pick(random, RESUMES), speech.label, between(random, 0.6, 1.8));
    }
    if (at > 0 && random() < hesitates)
      say(pick(random, HESITATIONS), speech.label, between(random, 0.3, 1.4));
    let said = roughen(chunk, opensSentence, random);
    const first = chunk[0] ?? "";
    // A word said twice, or a start abandoned and made again.
    if (random() < 0.04 && /^[a-z]+$/i.test(first))
      said = `${first.toLowerCase()}… ${said}`;
    else if (chunk.length >= 4 && random() < 0.025)
      say(
        `${chunk
          .slice(0, 2)
          .join(" ")
          .replace(/[,.;:]$/, "")}…`,
      );
    // The recorder loses the speaker now and then.
    say(said, random() < 0.012 ? UNKNOWN : speech.label);
    opensSentence = ENDS_SENTENCE.test(chunk.at(-1) ?? "");
    if (speech.other && body.length > 6 && at < body.length - 1)
      if (random() < 0.035)
        say(
          pick(random, BACK_CHANNELS),
          random() < 0.25 ? UNKNOWN : speech.other,
        );
  }
  if (tailSize > 0) say(words.slice(words.length - tailSize).join(" "));
  return { fragments, tail: fragments.length - 1 };
}

// The last three to five words of a rendered question, without the mark that
// ends it; fewer words when that avoids a comma in the middle.
function completingWords(text: string): string {
  const words = text.split(" ");
  const clean = (phrase: string[]) =>
    phrase.join(" ").replace(/[,.;:?!…]+$/, "");
  for (const size of [5, 4, 3]) {
    const phrase = words.slice(-size);
    if (!phrase.slice(0, -1).some((word) => ENDS_CLAUSE.test(word)))
      return clean(phrase);
  }
  return clean(words.slice(-5));
}

function clockSeconds(clock: string): number {
  const [hours, minutes, seconds] = clock.split(":").map(Number);
  return (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0);
}

function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  const part = (value: number) => String(value).padStart(2, "0");
  return `${part(Math.floor(whole / 3600))}:${part(Math.floor(whole / 60) % 60)}:${part(whole % 60)}`;
}

type Segment = {
  fragments: Fragment[];
  // The questions asked in it: where each one's fragments begin and end.
  asked: {
    question: Pick<CallQuestion, "id" | "from" | "evidence" | "about">;
    first: number;
    last: number;
  }[];
};

function exchangeSegment(
  exchange: CallExchange,
  scenario: CallScenario,
  me: string,
  random: Random,
): Segment {
  const segment: Segment = { fragments: [], asked: [] };
  const evidence = exchange.evidence ?? [];
  const about = exchange.about ?? [];
  const interviewers = Object.keys(scenario.people).filter(
    (label) => scenario.people[label]?.part === "interviewer",
  );
  const add = (speech: Speech) => {
    const first = segment.fragments.length;
    const { fragments, tail } = speak(speech, scenario, random);
    const [opening] = fragments;
    // A turn is handed over after a breath.
    if (opening) opening.pause = between(random, 0.5, 2.4);
    segment.fragments.push(...fragments);
    return { first, last: first + tail };
  };
  const round = (id: string, ask: string, answer: string, cutIns: number) => {
    const asked = add({
      label: exchange.from,
      text: ask,
      other: me,
      question: true,
      interviewer: true,
    });
    segment.asked.push({
      question: { id, from: exchange.from, evidence, about },
      ...asked,
    });
    const others = interviewers.filter((label) => label !== exchange.from);
    add({
      label: me,
      text: answer,
      other: exchange.from,
      ...(cutIns > 0
        ? {
            cutIns: {
              by: random() < 0.6 ? exchange.from : pick(random, others),
              times: cutIns,
            },
          }
        : {}),
    });
  };
  round(
    exchange.id,
    exchange.ask,
    exchange.answer,
    exchange.interruptions ?? 0,
  );
  for (const [at, followUp] of (exchange.followUps ?? []).entries())
    round(`${exchange.id}-follow-${at + 1}`, followUp.ask, followUp.answer, 0);
  return segment;
}

function fillerSegment(
  turns: readonly CallTurn[],
  scenario: CallScenario,
  random: Random,
): Segment {
  const fragments: Fragment[] = [];
  for (const [label, text] of turns) {
    const said = speak(
      {
        label,
        text,
        interviewer: scenario.people[label]?.part === "interviewer",
      },
      scenario,
      random,
    ).fragments;
    const [opening] = said;
    if (opening) opening.pause = between(random, 0.4, 1.8);
    fragments.push(...said);
  }
  return { fragments, asked: [] };
}

// [STRATEGY] The first small talk opens the call. The rest are taken a kind
// at a time (a tangent, some logistics, more small talk) in the order they
// are written, each into a gap between two exchanges chosen by the seed,
// until the call is as long as asked or nothing is left to say.
function fillerQueue(fillers: CallScenario["fillers"]): CallTurn[][] {
  const kinds = [
    fillers.tangents,
    fillers.logistics,
    fillers.smallTalk.slice(1),
  ];
  const queue: CallTurn[][] = [];
  const longest = Math.max(...kinds.map((kind) => kind.length));
  for (let at = 0; at < longest; at += 1)
    for (const kind of kinds) {
      const filler = kind[at];
      if (filler) queue.push(filler);
    }
  return queue;
}

export function renderCall(scenario: CallScenario): {
  transcript: string;
  questions: CallQuestion[];
} {
  // [GUARD] A call needs a candidate to answer.
  const me = Object.keys(scenario.people).find(
    (label) => scenario.people[label]?.part === "me",
  );
  if (!me) throw new Error("The scenario names nobody as the candidate.");
  const random = seeded(scenario.seed);

  // The real exchanges, in the order written; between them, room for fillers.
  const exchanges = scenario.exchanges.map((exchange) =>
    exchangeSegment(exchange, scenario, me, random),
  );
  const [opening] = scenario.fillers.smallTalk;
  const before: Segment[] = opening
    ? [fillerSegment(opening, scenario, random)]
    : [];
  const gaps: Segment[][] = exchanges.map(() => []);
  let total = [...before, ...exchanges].reduce(
    (sum, segment) => sum + segment.fragments.length,
    0,
  );
  // The gaps after an exchange, each used once before any is used twice.
  let free: number[] = [];
  for (const filler of fillerQueue(scenario.fillers)) {
    if (total >= scenario.targetFragments || exchanges.length < 2) break;
    if (free.length === 0) free = exchanges.slice(1).map((_, at) => at);
    const [gap] = free.splice(below(random, free.length), 1);
    const segment = fillerSegment(filler, scenario, random);
    gaps[gap ?? 0]?.push(segment);
    total += segment.fragments.length;
  }
  const segments = [
    ...before,
    ...exchanges.flatMap((exchange, at) => [exchange, ...(gaps[at] ?? [])]),
  ];

  // One pass gives every fragment its clock: about 2.5 words a second, a
  // short breath between a speaker's fragments, longer when the turn changes.
  const blocks: string[] = [];
  const questions: CallQuestion[] = [];
  let now = clockSeconds(scenario.startsAt);
  let previous = "";
  for (const segment of segments) {
    const times: { start: number; end: number }[] = [];
    for (const fragment of segment.fragments) {
      const sameSpeaker = fragment.speaker === previous;
      const breath = sameSpeaker
        ? random() < 0.1
          ? between(random, 0.7, 2.0)
          : between(random, 0, 0.4)
        : between(random, 0.2, 1.1);
      const start = now + (fragment.pause ?? breath);
      const count = fragment.text.split(" ").length;
      const end =
        start +
        Math.max(0.3, (count / WORDS_PER_SECOND) * between(random, 0.8, 1.25));
      times.push({ start, end });
      blocks.push(
        `${clock(start)} --> ${clock(end)}\n${fragment.label}: ${fragment.text}\n`,
      );
      now = end;
      previous = fragment.speaker;
    }
    for (const asked of segment.asked)
      questions.push({
        id: asked.question.id,
        from: asked.question.from,
        completeWhenSaid: completingWords(
          segment.fragments[asked.last]?.text ?? "",
        ),
        startsAt: clock(times[asked.first]?.start ?? now),
        endsAt: clock(times[asked.last]?.end ?? now),
        evidence: asked.question.evidence,
        about: asked.question.about,
      });
  }
  return { transcript: `${blocks.join("\n")}\n`, questions };
}
