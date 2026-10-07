// The Code panel (the library Panel: a 40 px header with the title, the
// language and Copy; the body holds the card). The card: file tabs (Solution,
// Usage and Tests, like the main answers page; a tab only when the run
// published that file), the badges the server's own code states give, why it is
// not fully verified, the repair line, the highlighted code (read-only, no run),
// the syntax problems and the approach note. The Tests drawer on the left edge keeps
// the per-test results and counts; its failure links open the Tests tab (or the
// Solution tab) on the failing line.
import { Button, Empty, Panel, Tag } from "@oc-tech/omni-ui-components";
import { useState } from "react";
import { Icon } from "../../../icon";
import type {
  CardBadge,
  CardCode,
  TaskCard,
} from "../../shared/task-card-model";
import { WAITS_FOR_APPROACH } from "./panel-model";
import { ReadOnlyCode } from "./read-only-code";
import { TestsDrawer, TestsHandle } from "./tests-drawer";
import { testsDrawerView } from "./tests-drawer-model";
import { useTestsDrawerOpen } from "./tests-drawer-pref";

type ShownFile = "solution" | "usage" | "tests";

// Where a line request lands: the file to show and the line to mark.
type FileFocus = { file: ShownFile; line: number };

const FILE_LABEL: Record<ShownFile, string> = {
  solution: "Solution",
  usage: "Usage example",
  tests: "Generated test source",
};

function repairLine(repair: CardCode["repair"]): string | null {
  if (repair.succeeded) return "Fixed after a repair";
  return repair.attempted ? "Repair attempted" : null;
}

export function CodeCard({
  code,
  constraints,
  badges,
  copy,
  example = null,
}: {
  code: CardCode;
  constraints: TaskCard["constraints"];
  badges: readonly CardBadge[];
  copy: { label: string; copied: boolean; onCopy(text: string): void };
  // The task's example input and output, shown above the code.
  example?: string | null;
}) {
  const drawer = useTestsDrawerOpen();
  const [tab, setTab] = useState<ShownFile>("solution");
  const [focus, setFocus] = useState<FileFocus | null>(null);
  const usage = code.files.find((file) => file.id === "usage");
  const solutionName =
    code.files.find((file) => file.id === "solution")?.name ?? "solution";
  const tests = code.files.find((file) => file.id === "tests");
  const shown: ShownFile =
    tab === "usage" && usage
      ? "usage"
      : tab === "tests" && tests
        ? "tests"
        : "solution";
  const text =
    shown === "usage" && usage
      ? usage.text
      : shown === "tests" && tests
        ? tests.text
        : code.text;
  const tabs: { id: ShownFile; name: string }[] = [
    { id: "solution", name: solutionName },
    ...(usage ? [{ id: "usage" as const, name: usage.name }] : []),
    ...(tests ? [{ id: "tests" as const, name: tests.name }] : []),
  ];
  // [DOMAIN] A line link names the file it belongs to: switch to that tab and
  // mark the line there, so a failing test is read next to its own source.
  const reveal = (file: ShownFile, line: number) => {
    setTab(file);
    setFocus({ file, line });
  };
  const revealSolution = (line: number) => reveal("solution", line);
  const repair = repairLine(code.repair);
  const view = testsDrawerView(code, constraints);
  return (
    <Panel
      title="Code"
      meta={
        <Tag mono variant="filled" data-testid="pn-language">
          {code.language.toUpperCase()}
        </Tag>
      }
      actions={
        <Button
          variant="outline"
          buttonSize="sm"
          icon={<Icon name={copy.copied ? "check" : "content_copy"} />}
          onClick={() => copy.onCopy(text)}
        >
          {copy.copied ? "Copied" : copy.label}
        </Button>
      }
      data-testid="pn-code"
    >
      <div className="pn-code-body">
        <TestsHandle open={drawer.open} onToggle={drawer.toggle} />
        <TestsDrawer open={drawer.open} view={view} onReveal={reveal} />
        <div className="pn-codemain">
          {example && <TextCard text={example} />}
          {tabs.length > 1 && (
            <div className="pn-file-tabs" role="group" aria-label="File">
              {tabs.map((file) => (
                <Button
                  key={file.id}
                  variant="ghost"
                  buttonSize="sm"
                  pressed={shown === file.id}
                  onClick={() => setTab(file.id)}
                >
                  {file.name}
                </Button>
              ))}
            </div>
          )}
          {badges.length > 0 && (
            <ul
              className="pn-badges"
              aria-label="What is established about this code"
            >
              {badges.map((badge) => (
                <li key={badge.id} data-ok={badge.ok ? "true" : "false"}>
                  <Tag variant="filled">
                    <Icon name={badge.ok ? "check_circle" : "help"} filled />
                    {badge.label}
                  </Tag>
                </li>
              ))}
            </ul>
          )}
          {view.notVerified && (
            <p className="pn-code-line" data-testid="pn-code-reasons">
              {view.notVerified}
            </p>
          )}
          {repair && (
            <p className="pn-code-line" data-testid="pn-code-repair">
              {repair}
            </p>
          )}
          <ReadOnlyCode
            language={code.language}
            text={text}
            label={FILE_LABEL[shown]}
            focus={focus?.file === shown ? { line: focus.line } : null}
          />
          {code.diagnostics.length > 0 && (
            <section className="pn-problems" aria-label="Problems">
              <h3 className="pn-code-heading">Problems</h3>
              <ul>
                {code.diagnostics.map((problem) => (
                  <li
                    key={`${problem.line}:${problem.column ?? 0}:${problem.message}`}
                  >
                    <Button
                      variant="link"
                      buttonSize="sm"
                      onClick={() => revealSolution(problem.line)}
                    >
                      Line {problem.line}
                      {problem.column ? `:${problem.column}` : ""}
                    </Button>{" "}
                    {problem.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {code.notes && (
            <details className="pn-approach-note">
              <summary>Approach note</summary>
              <p>{code.notes}</p>
            </details>
          )}
        </div>
      </div>
    </Panel>
  );
}

// The Code panel while there is no code: the board's 40 px icon tile and one
// line (the model's own sentence per state), never a promise not made.
export function CodeEmpty({ text, busy }: { text: string; busy: boolean }) {
  return (
    <Panel title="Code" data-testid="pn-code-pane">
      <Empty
        variant="tile"
        data-testid="pn-code-placeholder"
        icon={
          busy ? (
            <span className="pn-spinner" aria-hidden="true" />
          ) : (
            <Icon name={text === WAITS_FOR_APPROACH ? "schedule" : "code"} />
          )
        }
        description={text}
      />
    </Panel>
  );
}

export function TextCard({ text }: { text: string }) {
  return (
    <section className="pn-example" aria-label="Example" data-testid="pn-text">
      <div className="pn-code-heading">TEXT</div>
      <pre className="pn-example-pre">{text}</pre>
    </section>
  );
}
