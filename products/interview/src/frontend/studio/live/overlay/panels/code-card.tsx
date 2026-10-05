// The code pane's card: the language, file tabs (Solution, and Usage when the
// run has one) and Copy in the header, the badges the server's own code states
// give, why it is not fully verified, the repair line, the highlighted code
// (read-only, no run), the syntax problems and the approach note. The generated
// tests live in the Tests drawer on its left edge.
import { useState } from "react";
import { Icon } from "../../../icon";
import type {
  CardBadge,
  CardCode,
  TaskCard,
} from "../../shared/task-card-model";
import { type LineFocus, ReadOnlyCode } from "./read-only-code";
import { TestsDrawer, TestsHandle } from "./tests-drawer";
import { testsDrawerView } from "./tests-drawer-model";
import { useTestsDrawerOpen } from "./tests-drawer-pref";

type ShownFile = "solution" | "usage";

function repairLine(repair: CardCode["repair"]): string | null {
  if (repair.succeeded) return "Fixed after a repair";
  return repair.attempted ? "Repair attempted" : null;
}

export function CodeCard({
  code,
  constraints,
  badges,
  copy,
}: {
  code: CardCode;
  constraints: TaskCard["constraints"];
  badges: readonly CardBadge[];
  copy: { label: string; copied: boolean; onCopy(text: string): void };
}) {
  const drawer = useTestsDrawerOpen();
  const [tab, setTab] = useState<ShownFile>("solution");
  const [focus, setFocus] = useState<LineFocus | null>(null);
  const usage = code.files.find((file) => file.id === "usage");
  const solutionName =
    code.files.find((file) => file.id === "solution")?.name ?? "solution";
  const shown: ShownFile = tab === "usage" && usage ? "usage" : "solution";
  const text = shown === "usage" && usage ? usage.text : code.text;
  const tabs: { id: ShownFile; name: string }[] = [
    { id: "solution", name: solutionName },
    ...(usage ? [{ id: "usage" as const, name: usage.name }] : []),
  ];
  const revealSolution = (line: number) => {
    setTab("solution");
    setFocus({ line });
  };
  const repair = repairLine(code.repair);
  const view = testsDrawerView(code, constraints);
  return (
    <section
      className="pn-codecard pn-codecard-split"
      aria-label="Code"
      data-testid="pn-code"
    >
      <TestsHandle open={drawer.open} onToggle={drawer.toggle} />
      <TestsDrawer
        open={drawer.open}
        view={view}
        language={code.language}
        onRevealSolution={revealSolution}
      />
      <div className="pn-codemain">
        <div className="pn-codecard-head">
          <span className="pn-codecard-language" data-testid="pn-language">
            {code.language.toUpperCase()}
          </span>
          <button
            type="button"
            className="pn-mini-button"
            onClick={() => copy.onCopy(text)}
          >
            <Icon name={copy.copied ? "check" : "content_copy"} />
            {copy.copied ? "Copied" : copy.label}
          </button>
        </div>
        {tabs.length > 1 && (
          <div className="pn-file-tabs" role="group" aria-label="File">
            {tabs.map((file) => (
              <button
                key={file.id}
                type="button"
                className="pn-file-tab"
                aria-pressed={shown === file.id}
                onClick={() => setTab(file.id)}
              >
                {file.name}
              </button>
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
                <Icon name={badge.ok ? "check_circle" : "help"} filled />
                {badge.label}
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
          label={shown === "usage" ? "Usage example" : "Solution"}
          focus={shown === "solution" ? focus : null}
        />
        {code.diagnostics.length > 0 && (
          <section className="pn-problems" aria-label="Problems">
            <h3 className="pn-codecard-head">Problems</h3>
            <ul>
              {code.diagnostics.map((problem) => (
                <li
                  key={`${problem.line}:${problem.column ?? 0}:${problem.message}`}
                >
                  <button
                    type="button"
                    className="pn-linkbtn"
                    onClick={() => revealSolution(problem.line)}
                  >
                    Line {problem.line}
                    {problem.column ? `:${problem.column}` : ""}
                  </button>{" "}
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
    </section>
  );
}

export function TextCard({ text }: { text: string }) {
  return (
    <section className="pn-codecard" aria-label="Example" data-testid="pn-text">
      <div className="pn-codecard-head">TEXT</div>
      <pre className="pn-codecard-pre">{text}</pre>
    </section>
  );
}
