// A read-only highlighted file with line numbers: the code canvas's own editor
// (the Workspace's language support, the default highlighting), plus one line
// that can be marked and scrolled to. The Solution, Usage and generated test
// views all use it, so they cannot look different.
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { Decoration, EditorView } from "@codemirror/view";
import type { Language } from "@omnitech/interview-contracts";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef } from "react";
import { languageExtensions } from "../../../workspace/code-panel";

const LANGUAGES: readonly string[] = ["typescript", "react", "php", "ruby"];
export const asLanguage = (value: string): Language =>
  (LANGUAGES.includes(value) ? value : "typescript") as Language;

export type LineFocus = { line: number };

const markLine = (line: number) =>
  EditorView.decorations.of((view) =>
    line >= 1 && line <= view.state.doc.lines
      ? Decoration.set([
          Decoration.line({ class: "pn-line-hit" }).range(
            view.state.doc.line(line).from,
          ),
        ])
      : Decoration.none,
  );

export function ReadOnlyCode({
  language,
  text,
  label,
  focus,
}: {
  language: string;
  text: string;
  label: string;
  focus: LineFocus | null;
}) {
  const view = useRef<EditorView | null>(null);
  const line = focus?.line ?? 0;
  const extensions = useMemo(
    () => [
      ...languageExtensions(asLanguage(language)),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.contentAttributes.of({ "aria-label": label }),
      // The panel is a fixed column: a long line wraps instead of running past
      // its edge (QA issue 013).
      EditorView.lineWrapping,
      markLine(line),
    ],
    [language, label, line],
  );
  // Each request is a new object, so the same line scrolls again.
  useEffect(() => {
    const editor = view.current;
    if (!focus || !editor) return;
    if (focus.line < 1 || focus.line > editor.state.doc.lines) return;
    editor.dispatch({
      effects: EditorView.scrollIntoView(
        editor.state.doc.line(focus.line).from,
        { y: "center" },
      ),
    });
  }, [focus]);
  return (
    <CodeMirror
      value={text}
      editable={false}
      readOnly
      theme="dark"
      extensions={extensions}
      onCreateEditor={(editor) => {
        view.current = editor;
      }}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
    />
  );
}
