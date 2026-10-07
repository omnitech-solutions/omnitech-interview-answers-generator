// The Tests drawer on the left of the code pane: what the server established
// about the generated tests (its counts, never recomputed), one row per
// reported test. The generated test source is the card's Tests tab, not here.
// Read-only: the app never runs or types for the person, so there is no Run
// control.
import { Button, IconButton, Tag } from "@oc-tech/omni-ui-components";
import { Icon } from "../../../icon";
import {
  NO_FAILURE_DETAILS,
  type TestRowView,
  type TestsDrawerView,
} from "./tests-drawer-model";

export const TESTS_DRAWER_ID = "pn-tests-drawer";

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
    <IconButton
      className="pn-tests-handle"
      variant="ghost"
      iconSize="sm"
      label="Tests"
      aria-expanded={open}
      aria-controls={TESTS_DRAWER_ID}
      title={open ? "Hide generated tests" : "Show generated tests"}
      data-testid="pn-tests-handle"
      onClick={onToggle}
      icon={<span aria-hidden="true">{open ? "|<|" : "|>|"}</span>}
    />
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
              <Button
                variant="link"
                buttonSize="sm"
                onClick={() =>
                  failure.link &&
                  onReveal(failure.link.editor, failure.link.line)
                }
              >
                {failure.link.label}
              </Button>
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
  onReveal,
}: {
  open: boolean;
  view: TestsDrawerView;
  onReveal(editor: "solution" | "tests", line: number): void;
}) {
  // A tests line can only be shown when a test source (the Tests tab) exists.
  const hasSource = !("unavailable" in view.source);
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
                  <Tag variant="filled">
                    {count.label} <strong>{count.value}</strong>
                  </Tag>
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
                  onReveal={onReveal}
                />
              ))}
            </ul>
          ) : (
            <p className="pn-placeholder" data-testid="pn-tests-unavailable">
              {view.list.text}
            </p>
          )}
          {"unavailable" in view.source && (
            <p className="pn-placeholder" data-testid="pn-tests-nosource">
              {view.source.unavailable}
            </p>
          )}
        </>
      )}
    </aside>
  );
}
