// The code pane's card: the language and Copy in the header, the badges the
// server's own code states give (generated, tests it counted, not fully
// verified), and the highlighted code (no tabs, no run). It is the code
// canvas's own editor, read-only: the same CodeMirror, the Workspace's language
// support and the same highlighting. The `TEXT` card above it is the worked
// example.
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Language } from "@omnitech/interview-contracts";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { Icon } from "../../../icon";
import { languageExtensions } from "../../../workspace/code-panel";
import type { CardBadge } from "../../shared/task-card-model";

const LANGUAGES: readonly string[] = ["typescript", "react", "php", "ruby"];
const asLanguage = (value: string): Language =>
  (LANGUAGES.includes(value) ? value : "typescript") as Language;

export function CodeCard({
  language,
  text,
  badges,
  copy,
}: {
  language: string;
  text: string;
  badges: readonly CardBadge[];
  copy: { label: string; copied: boolean; onCopy(): void };
}) {
  const extensions = useMemo(
    () => [
      ...languageExtensions(asLanguage(language)),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    ],
    [language],
  );
  return (
    <section className="pn-codecard" aria-label="Code" data-testid="pn-code">
      <div className="pn-codecard-head">
        <span className="pn-codecard-language" data-testid="pn-language">
          {language.toUpperCase()}
        </span>
        <button type="button" className="pn-mini-button" onClick={copy.onCopy}>
          <Icon name={copy.copied ? "check" : "content_copy"} />
          {copy.copied ? "Copied" : copy.label}
        </button>
      </div>
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
      <CodeMirror
        value={text}
        editable={false}
        readOnly
        theme="dark"
        extensions={extensions}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
      />
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
