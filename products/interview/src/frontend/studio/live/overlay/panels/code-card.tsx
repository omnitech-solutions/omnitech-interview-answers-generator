// The analysis panel's code card: a small uppercase header and the highlighted
// code, nothing else (no tabs, no run, no results). It is the code canvas's own
// editor, read-only: the same CodeMirror, the Workspace's language support and
// the same highlighting. The `TEXT` card above it is the worked example.
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Language } from "@omnitech/interview-contracts";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { languageExtensions } from "../../../workspace/code-panel";

const LANGUAGES: readonly string[] = ["typescript", "react", "php", "ruby"];
const asLanguage = (value: string): Language =>
  (LANGUAGES.includes(value) ? value : "typescript") as Language;

export function CodeCard({
  language,
  text,
}: {
  language: string;
  text: string;
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
      <div className="pn-codecard-head" data-testid="pn-language">
        {language.toUpperCase()}
      </div>
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
