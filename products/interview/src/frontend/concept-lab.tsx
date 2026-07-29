"use client";

import { Button, Card, IconButton } from "@oc-tech/omni-ui-components";
import type {
  GeneratedExplanation,
  SavedExplanation,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ConceptMarkdownContent } from "./concept-markdown-content";
import { formatTimestamp } from "./format-timestamp";
import { StudioInspector } from "./studio-inspector";
import { TerminalDock } from "./terminal-dock";

const DRAFT_KEY = "interview-studio.concept-lab";
type ConceptProvider = "" | "openai" | "lm-studio" | "codex";
const CONCEPT_SESSION_PATTERN = /^concept-[a-z0-9-]+$/;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T | { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(
      "error" in (body as object) &&
        (body as { error?: { message?: string } }).error?.message
        ? (body as { error: { message: string } }).error.message
        : `Request failed with HTTP ${response.status}.`,
    );
  }
  return body as T;
}

export interface ConceptDraft extends GeneratedExplanation {
  topic: string;
}

export function ConceptLab({
  externalDraft,
  externalDrafts,
  inspectorOpen = false,
  onClearExternal,
  onInspectorClose,
  onTerminalClose,
  onTerminalOpen,
  terminalOpen = false,
  toolbarTarget,
}: {
  externalDraft?: ConceptDraft;
  externalDrafts?: ConceptDraft[];
  inspectorOpen?: boolean;
  onClearExternal?: () => void;
  onInspectorClose?: () => void;
  onTerminalClose?: () => void;
  onTerminalOpen?: () => void;
  terminalOpen?: boolean;
  toolbarTarget?: HTMLElement | null;
}) {
  const [topic, setTopic] = useState("");
  const [answerTopic, setAnswerTopic] = useState("");
  const [provider, setProvider] = useState<ConceptProvider>("");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [followUps, setFollowUps] = useState<ConceptDraft[]>([]);
  const [savedId, setSavedId] = useState<string>();
  const [saved, setSaved] = useState<SavedExplanation[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [terminalSession, setTerminalSession] = useState("workspace");

  const loadSaved = useCallback(async () => {
    setSaved(await request<SavedExplanation[]>("/explanations"));
  }, []);

  useEffect(() => {
    void loadSaved();
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as Partial<ConceptDraft> & {
        provider?: ConceptProvider;
        terminalSession?: unknown;
      };
      setTopic(draft.markdown ? "" : (draft.topic ?? ""));
      setAnswerTopic(
        draft.markdown
          ? ((draft as Partial<ConceptDraft> & { answerTopic?: string })
              .answerTopic ??
              draft.topic ??
              "")
          : "",
      );
      setProvider(
        ["", "openai", "lm-studio", "codex"].includes(draft.provider ?? "")
          ? (draft.provider as ConceptProvider)
          : "",
      );
      setTitle(draft.title ?? "");
      setMarkdown(draft.markdown ?? "");
      if (
        typeof draft.terminalSession === "string" &&
        CONCEPT_SESSION_PATTERN.test(draft.terminalSession)
      ) {
        setTerminalSession(draft.terminalSession);
      }
      setFollowUps(
        Array.isArray(
          (draft as Partial<ConceptDraft> & { followUps?: unknown }).followUps,
        )
          ? ((draft as Partial<ConceptDraft> & { followUps: ConceptDraft[] })
              .followUps ?? [])
          : [],
      );
    } catch {
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }, [loadSaved]);

  useEffect(() => {
    const drafts = externalDrafts?.length
      ? externalDrafts
      : externalDraft
        ? [externalDraft]
        : [];
    const [first, ...rest] = drafts;
    if (!first) return;
    setTopic("");
    setAnswerTopic(first.topic);
    setTitle(first.title);
    setMarkdown(first.markdown);
    setFollowUps(rest);
    setSavedId(undefined);
    setStatus(
      rest.length
        ? `Briefing session updated with ${rest.length} follow-up${rest.length === 1 ? "" : "s"}.`
        : "Briefing updated through the CLI.",
    );
  }, [externalDraft, externalDrafts]);

  useEffect(() => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        topic,
        answerTopic,
        provider,
        title,
        markdown,
        followUps,
        terminalSession,
      }),
    );
  }, [
    answerTopic,
    followUps,
    markdown,
    provider,
    terminalSession,
    title,
    topic,
  ]);

  async function generate() {
    if (!topic.trim() || !provider) return;
    const submittedTopic = topic.trim();
    setBusy(true);
    setStatus(
      provider === "codex"
        ? "Starting a fresh Codex terminal session…"
        : `Building interview talking points with ${
            provider === "lm-studio" ? "LM Studio" : "OpenAI"
          }…`,
    );
    try {
      if (provider === "codex") {
        const session = await request<{ name: string }>("/concept-sessions", {
          method: "POST",
          body: JSON.stringify({ topic: submittedTopic }),
        });
        setTerminalSession(session.name);
        onTerminalOpen?.();
        setStatus(
          `Codex session “${session.name}” started. Its /explain result will appear here.`,
        );
        return;
      }
      const result = await request<GeneratedExplanation>("/explain", {
        method: "POST",
        body: JSON.stringify({ topic: submittedTopic, providerId: provider }),
      });
      if (markdown.trim()) {
        setFollowUps((current) => [
          ...current,
          { ...result, topic: submittedTopic },
        ]);
        setStatus("Answer added to the top of the briefing.");
      } else {
        setAnswerTopic(submittedTopic);
        setTitle(result.title);
        setMarkdown(result.markdown);
        setStatus("Answer generated. It has not been saved.");
      }
      setTopic("");
      setSavedId(undefined);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const latest =
      followUps.at(-1) ??
      (markdown.trim() ? { topic: answerTopic, title, markdown } : undefined);
    if (!latest?.title.trim() || !latest.markdown.trim()) return;
    setBusy(true);
    try {
      const result = await request<SavedExplanation>("/explanations", {
        method: "POST",
        body: JSON.stringify({
          id: savedId,
          topic: latest.topic,
          title: latest.title,
          markdown: latest.markdown,
        }),
      });
      setSavedId(result.id);
      await loadSaved();
      setStatus("Briefing saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function open(item: SavedExplanation) {
    setTopic("");
    setAnswerTopic(item.topic);
    setTitle(item.title);
    setMarkdown(item.markdown);
    setFollowUps([]);
    setSavedId(item.id);
    setSavedOpen(false);
    setStatus(`Opened “${item.title}”.`);
  }

  async function remove(id: string) {
    await request(`/explanations/${id}`, { method: "DELETE" });
    if (savedId === id) setSavedId(undefined);
    await loadSaved();
    setStatus("Saved briefing deleted.");
  }

  async function clear() {
    window.localStorage.removeItem(DRAFT_KEY);
    setTopic("");
    setAnswerTopic("");
    setProvider("");
    setTitle("");
    setMarkdown("");
    setFollowUps([]);
    setSavedId(undefined);
    setSavedOpen(false);
    setStatus("");
    setTerminalSession("workspace");
    onClearExternal?.();
    onTerminalClose?.();
    onInspectorClose?.();
    try {
      await request<unknown>("/playground-control", {
        method: "PATCH",
        body: JSON.stringify({
          view: "concept-lab",
          explanation: null,
          panel: "output",
        }),
      });
      onClearExternal?.();
      setStatus("New unsaved briefing.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Briefing cleared locally. ${error.message}`
          : "Briefing cleared locally.",
      );
    }
  }

  const actions = (
    <div className="concept-actions">
      <Button variant="outline" onClick={() => void clear()} disabled={busy}>
        New
      </Button>
      <Button
        variant="outline"
        onClick={() => void save()}
        disabled={busy || !markdown.trim()}
      >
        Save
      </Button>
      <Button variant="outline" onClick={() => setSavedOpen((value) => !value)}>
        Saved
      </Button>
    </div>
  );

  return (
    <section className="concept-lab" aria-labelledby="concept-lab-title">
      <div className="concept-lab-heading">
        <div>
          <span className="eyebrow">INTERVIEW BRIEFINGS</span>
          <h2 id="concept-lab-title">Briefing</h2>
          <p>
            Fast recall for full-stack concepts, DSA, and experience stories.
          </p>
        </div>
        {toolbarTarget ? createPortal(actions, toolbarTarget) : actions}
      </div>

      <Card className="concept-composer-card">
        <div className="concept-provider-field">
          <label htmlFor="concept-provider">Explanation provider</label>
          <select
            id="concept-provider"
            value={provider}
            onChange={(event) =>
              setProvider(event.target.value as ConceptProvider)
            }
          >
            <option value="">Choose a provider…</option>
            <option value="openai">OpenAI</option>
            <option value="lm-studio">LM Studio</option>
            <option value="codex">Codex CLI</option>
          </select>
        </div>
        <label htmlFor="concept-topic">What do you need to explain?</label>
        <div className="concept-question-entry">
          <textarea
            id="concept-topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="e.g. Explain React reconciliation, or give me a STAR story about modernizing an older workflow."
            rows={4}
          />
          <Button
            className="run-button concept-explain-button"
            onClick={() => void generate()}
            disabled={busy || !topic.trim() || !provider}
          >
            {busy ? "Working…" : "Explain"}
          </Button>
        </div>
      </Card>

      {markdown ? (
        <section className="concept-answer-list" aria-label="Concept answers">
          {[{ topic: answerTopic, title, markdown }, ...followUps]
            .toReversed()
            .map((answer, index) => (
              <Card
                className="concept-answer-card"
                key={`${answer.topic}-${answer.title}-${index}`}
              >
                <article className="markdown concept-markdown">
                  <ConceptMarkdownContent>
                    {answer.markdown}
                  </ConceptMarkdownContent>
                </article>
              </Card>
            ))}
        </section>
      ) : (
        <Card className="concept-answer-card concept-answer-empty">
          <div className="empty">
            <strong>Build a clear answer you can say out loud.</strong>
            <span>Questions and talking points will appear here.</span>
          </div>
        </Card>
      )}

      {savedOpen ? (
        <aside className="concept-saved" aria-label="Saved briefings">
          <div className="concept-saved-header">
            <h3>Saved briefings</h3>
            <IconButton
              aria-label="Close saved briefings"
              onClick={() => setSavedOpen(false)}
              icon={<span aria-hidden="true">×</span>}
            />
          </div>
          {saved.length ? (
            saved.map((item) => (
              <div className="concept-saved-item" key={item.id}>
                <button type="button" onClick={() => open(item)}>
                  <strong>{item.title}</strong>
                  <span>{formatTimestamp(item.updatedAt)}</span>
                </button>
                <IconButton
                  aria-label={`Delete ${item.title}`}
                  onClick={() => void remove(item.id)}
                  icon={<span aria-hidden="true">×</span>}
                />
              </div>
            ))
          ) : (
            <p>No saved briefings yet.</p>
          )}
        </aside>
      ) : null}
      <p className="status" role="status">
        {status}
      </p>
      {onTerminalClose ? (
        <StudioInspector
          className="concept-inspector"
          title="Concept Inspector"
          description="Use the terminal for Codex explanations and project commands."
          open={inspectorOpen}
          onOpenChange={(open) => {
            if (!open) onInspectorClose?.();
          }}
        >
          <TerminalDock
            className="inspector-terminal-dock"
            open={terminalOpen}
            onClose={onTerminalClose}
            sessionName={terminalSession}
          />
        </StudioInspector>
      ) : null}
    </section>
  );
}
