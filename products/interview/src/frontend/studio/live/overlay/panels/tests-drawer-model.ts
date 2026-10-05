// What the Tests drawer shows, derived from the shared card model alone: the
// server's counts, the honesty line, one row per reported test, the test source
// and the honest unavailable states. Pure, so every rule is a unit test.
import type { IconName } from "../../../icon";
import { STATE_REASON } from "../../session-draft-facts";
import type { RunTone } from "../../session-runs";
import {
  type CardCode,
  type CardTest,
  STAGE_PRESENTATION,
  type TaskCard,
} from "../../shared/task-card-model";

export const HONESTY_LINE = "Generated tests passing is not full verification.";
export const NO_RUNNER =
  "The code runner was not available, so no test result is claimed.";
export const NO_TEST_SOURCE = "No test source was published.";
export const NO_FAILURE_DETAILS = "Failure details not available";
const COVERS_LIMIT = 60;

// Passed and skipped reuse the stage vocabulary (done / not established); the
// stages have no failed state, so a failed test has its own entry.
export const TEST_STATUS_PRESENTATION: Record<
  CardTest["status"],
  { icon: IconName; tone: RunTone; word: string }
> = {
  passed: STAGE_PRESENTATION.done,
  skipped: STAGE_PRESENTATION["not-established"],
  failed: { icon: "cancel", tone: "red", word: "Failed" },
};

export type LineLink = { editor: "solution" | "tests"; line: number };

export type TestRowView = {
  key: string;
  name: string;
  status: CardTest["status"];
  presentation: (typeof TEST_STATUS_PRESENTATION)[CardTest["status"]];
  // "covers: <constraint text>", or null when no constraint is named.
  covers: string | null;
  // Failed rows only.
  failure: {
    message: string | null;
    link: (LineLink & { label: string }) | null;
    unavailable: boolean;
  } | null;
};

export type DrawerCount = { id: string; label: string; value: string };

export type TestsDrawerView = {
  // The accessible name of the counts: "Tests: 5 of 6 passed".
  summary: string;
  counts: DrawerCount[] | null;
  honesty: string;
  notVerified: string | null;
  list:
    | { kind: "unavailable"; text: string }
    | { kind: "empty"; text: string }
    | { kind: "rows"; rows: TestRowView[] };
  source: { name: string; text: string } | { unavailable: string };
};

const truncate = (text: string) =>
  text.length > COVERS_LIMIT ? `${text.slice(0, COVERS_LIMIT - 1)}…` : text;

// The constraint texts a test's zero-based indexes name; an index the card
// does not have is skipped rather than guessed.
export function coversText(
  covers: readonly number[] | undefined,
  constraints: TaskCard["constraints"],
): string | null {
  const texts = (covers ?? [])
    .map((index) => constraints[index]?.text)
    .filter((text): text is string => text !== undefined)
    .map(truncate);
  return texts.length > 0 ? `covers: ${texts.join("; ")}` : null;
}

function rowOf(
  test: CardTest,
  at: number,
  constraints: TaskCard["constraints"],
): TestRowView {
  const failed = test.status === "failed";
  const location = test.location;
  return {
    key: `${at}-${test.name}`,
    name: test.name,
    status: test.status,
    presentation: TEST_STATUS_PRESENTATION[test.status],
    covers: coversText(test.covers, constraints),
    failure: failed
      ? {
          message: test.message ?? null,
          link: location
            ? {
                editor: location.editor,
                line: location.line,
                label: `Go to line ${location.line} (${location.editor})`,
              }
            : null,
          unavailable: !test.message && !location,
        }
      : null,
  };
}

export function testsDrawerView(
  code: CardCode,
  constraints: TaskCard["constraints"],
): TestsDrawerView {
  const { tests, reasons } = code;
  const file = code.files.find((entry) => entry.id === "tests");
  const source = file
    ? { name: file.name, text: file.text }
    : { unavailable: NO_TEST_SOURCE };
  const base = {
    honesty: HONESTY_LINE,
    notVerified:
      reasons.length > 0 ? `Not fully verified: ${reasons.join(" ")}` : null,
    source,
  };
  if (tests === null)
    return {
      ...base,
      summary: "Tests: no result",
      counts: null,
      list: { kind: "unavailable", text: NO_RUNNER },
    };
  const counts: DrawerCount[] = [
    {
      id: "generated",
      label: "Generated",
      value: tests.generated ? "yes" : "no",
    },
    { id: "passed", label: "Passed", value: String(tests.passed) },
    { id: "failed", label: "Failed", value: String(tests.failed) },
    { id: "skipped", label: "Skipped", value: String(tests.skipped) },
  ];
  return {
    ...base,
    summary: `Tests: ${tests.passed} of ${tests.total} passed`,
    counts,
    list:
      tests.results.length === 0
        ? {
            kind: "empty",
            text:
              reasons.length > 0
                ? reasons.join(" ")
                : (STATE_REASON["no_tests"] ?? "The run reported no tests."),
          }
        : {
            kind: "rows",
            rows: tests.results.map((test, at) => rowOf(test, at, constraints)),
          },
  };
}
