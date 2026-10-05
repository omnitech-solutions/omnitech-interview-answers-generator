// The Tests drawer on the left of the code pane: what the server established
// about the generated tests (its counts, never recomputed), one row per
// reported test, and the generated test source to read aloud. Read-only: the
// app never runs or types for the person, so there is no Run control.
import { useEffect, useState } from "react";
import { Icon } from "../../../icon";
import { copyText } from "../../shared/copy-text";
import { type LineFocus, ReadOnlyCode } from "./read-only-code";
import {
  NO_FAILURE_DETAILS,
  type TestRowView,
  type TestsDrawerView,
} from "./tests-drawer-model";

export const TESTS_DRAWER_ID = "pn-tests-drawer";
const COPIED_MS = 1_600;

// The narrow handle on the pane's left edge. The glyphs are decoration: the
// button's name is "Tests" and its expanded state says which way it goes.
export function TestsHandle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle(): void;
}) {
  return (
    <button
      type="button"
      className="pn-tests-handle"
      aria-label="Tests"
      aria-expanded={open}
      aria-controls={TESTS_DRAWER_ID}
      title={open ? "Hide generated tests" : "Show generated tests"}
      data-testid="pn-tests-handle"
      onClick={onToggle}
    >
      <span aria-hidden="true">{open ? "|<|" : "|>|"}</span>
    </button>
  );
}

type Copy = "idle" | "copied" | "failed";

function TestSource({
  language,
  source,
  focus,
}: {
  language: string;
  source: TestsDrawerView["source"];
  focus: LineFocus | null;
}) {
  const [copy, setCopy] = useState<Copy>("idle");
  useEffect(() => {
    if (copy !== "copied") return;
    const timer = setTimeout(() => setCopy("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copy]);
  if ("unavailable" in source)
    return (
      <p className="pn-placeholder" data-testid="pn-tests-nosource">
        {source.unavailable}
      </p>
    );
  return (
    <section className="pn-tests-source" aria-label="Generated test source">
      <div className="pn-codecard-head">
        <span className="pn-codecard-language">{source.name}</span>
        <button
          type="button"
          className="pn-mini-button"
          data-testid="pn-tests-copy"
          onClick={() =>
            void copyText(source.text).then((ok) =>
              setCopy(ok ? "copied" : "failed"),
            )
          }
        >
          <Icon name={copy === "copied" ? "check" : "content_copy"} />
          {copy === "copied" ? "Copied" : "Copy tests"}
        </button>
      </div>
      {copy === "failed" && (
        <p className="pn-tests-note" role="status">
          Couldn’t copy. Select the tests and copy by hand.
        </p>
      )}
      <ReadOnlyCode
        language={language}
        text={source.text}
        label="Generated test source"
        focus={focus}
      />
    </section>
  );
}

function TestRow({
  row,
  canReveal,
  onReveal,
}: {
  row: TestRowView;
  canReveal(editor: "solution" | "tests"): boolean;
  onReveal(editor: "solution" | "tests", line: number): void;
}) {
  const { presentation, failure } = row;
  return (
    <li className="pn-test-row" data-status={row.status} data-testid="pn-test">
      <span className="pn-test-name">
        <span data-tone={presentation.tone}>
          <Icon name={presentation.icon} filled />
          <span className="pn-sr">{presentation.word}: </span>
        </span>
        {row.name}
      </span>
      {row.covers && <span className="pn-test-covers">{row.covers}</span>}
      {failure && (
        <span className="pn-test-failure">
          {failure.message && <span>{failure.message}</span>}
          {failure.link &&
            (canReveal(failure.link.editor) ? (
              <button
                type="button"
                className="pn-linkbtn"
                onClick={() =>
                  failure.link &&
                  onReveal(failure.link.editor, failure.link.line)
                }
              >
                {failure.link.label}
              </button>
            ) : (
              <span>{failure.link.label}</span>
            ))}
          {failure.unavailable && <span>{NO_FAILURE_DETAILS}</span>}
        </span>
      )}
    </li>
  );
}

export function TestsDrawer({
  open,
  view,
  language,
  onRevealSolution,
}: {
  open: boolean;
  view: TestsDrawerView;
  language: string;
  onRevealSolution(line: number): void;
}) {
  const [focus, setFocus] = useState<LineFocus | null>(null);
  const hasSource = !("unavailable" in view.source);
  const reveal = (editor: "solution" | "tests", line: number) =>
    editor === "tests" ? setFocus({ line }) : onRevealSolution(line);
  // Closed: the content is not mounted, and the element is inert and hidden from
  // assistive technology, so nothing in it can take focus.
  return (
    <aside
      id={TESTS_DRAWER_ID}
      className="pn-tests-drawer"
      role="complementary"
      aria-label="Generated tests"
      data-open={open}
      data-testid="pn-tests-drawer"
      hidden={!open}
      inert={!open}
      aria-hidden={!open}
    >
      {open && (
        <>
          {view.counts && (
            <ul className="pn-tests-counts" aria-label={view.summary}>
              {view.counts.map((count) => (
                <li key={count.id}>
                  {count.label} <strong>{count.value}</strong>
                </li>
              ))}
            </ul>
          )}
          <p className="pn-tests-honesty" data-testid="pn-tests-honesty">
            {view.honesty}
          </p>
          {view.notVerified && (
            <p className="pn-tests-honesty" data-testid="pn-tests-notverified">
              {view.notVerified}
            </p>
          )}
          {view.list.kind === "rows" ? (
            <ul className="pn-tests-list" aria-label="Test results">
              {view.list.rows.map((row) => (
                <TestRow
                  key={row.key}
                  row={row}
                  canReveal={(editor) => editor === "solution" || hasSource}
                  onReveal={reveal}
                />
              ))}
            </ul>
          ) : (
            <p className="pn-placeholder" data-testid="pn-tests-unavailable">
              {view.list.text}
            </p>
          )}
          <TestSource language={language} source={view.source} focus={focus} />
        </>
      )}
    </aside>
  );
}
