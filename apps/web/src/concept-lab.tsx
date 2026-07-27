"use client";

import { Button, Card, IconButton } from "@oc-tech/omni-ui-components";
import type {
  GeneratedExplanation,
  SavedExplanation,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useState } from "react";
import { MarkdownContent } from "./markdown-content";

const DRAFT_KEY = "interview-studio.concept-lab";

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
}: {
  externalDraft?: ConceptDraft;
  externalDrafts?: ConceptDraft[];
}) {
  const [topic, setTopic] = useState("");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [followUps, setFollowUps] = useState<ConceptDraft[]>([]);
  const [openFollowUps, setOpenFollowUps] = useState<number[]>([]);
  const [savedId, setSavedId] = useState<string>();
  const [saved, setSaved] = useState<SavedExplanation[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const loadSaved = useCallback(async () => {
    setSaved(await request<SavedExplanation[]>("/explanations"));
  }, []);

  useEffect(() => {
    void loadSaved();
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as Partial<ConceptDraft>;
      setTopic(draft.topic ?? "");
      setTitle(draft.title ?? "");
      setMarkdown(draft.markdown ?? "");
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
    setTopic(first.topic);
    setTitle(first.title);
    setMarkdown(first.markdown);
    setFollowUps(rest);
    setOpenFollowUps([]);
    setSavedId(undefined);
    setStatus(
      rest.length
        ? `Concept Lab session updated with ${rest.length} follow-up${rest.length === 1 ? "" : "s"}.`
        : "Concept Lab updated through the CLI.",
    );
  }, [externalDraft, externalDrafts]);

  useEffect(() => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ topic, title, markdown, followUps }),
    );
  }, [followUps, markdown, title, topic]);

  async function generate() {
    if (!topic.trim()) return;
    setBusy(true);
    setStatus("Building interview talking points…");
    try {
      const result = await request<GeneratedExplanation>("/explain", {
        method: "POST",
        body: JSON.stringify({ topic }),
      });
      if (markdown.trim()) {
        setFollowUps((current) => [
          ...current,
          { ...result, topic: topic.trim() },
        ]);
        setOpenFollowUps([]);
        setStatus("Follow-up appended to this Concept Lab session.");
      } else {
        setTitle(result.title);
        setMarkdown(result.markdown);
        setStatus("Briefing generated. It has not been saved.");
      }
      setSavedId(undefined);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!topic.trim() || !title.trim() || !markdown.trim()) return;
    setBusy(true);
    try {
      const result = await request<SavedExplanation>("/explanations", {
        method: "POST",
        body: JSON.stringify({ id: savedId, topic, title, markdown }),
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
    setTopic(item.topic);
    setTitle(item.title);
    setMarkdown(item.markdown);
    setFollowUps([]);
    setOpenFollowUps([]);
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

  function clear() {
    setTopic("");
    setTitle("");
    setMarkdown("");
    setFollowUps([]);
    setOpenFollowUps([]);
    setSavedId(undefined);
    setStatus("New unsaved briefing.");
  }

  return (
    <section className="concept-lab" aria-labelledby="concept-lab-title">
      <div className="concept-lab-heading">
        <div>
          <span className="eyebrow">INTERVIEW BRIEFINGS</span>
          <h2 id="concept-lab-title">Concept Lab</h2>
          <p>
            Fast recall for full-stack concepts, DSA, and experience stories.
          </p>
        </div>
        <div className="concept-actions">
          <Button variant="outline" onClick={clear} disabled={busy}>
            New
          </Button>
          <Button
            onClick={() => void generate()}
            disabled={busy || !topic.trim()}
          >
            {busy ? "Working…" : "Explain"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void save()}
            disabled={busy || !markdown.trim()}
          >
            Save
          </Button>
          <Button
            variant="outline"
            onClick={() => setSavedOpen((value) => !value)}
          >
            Saved
          </Button>
        </div>
      </div>

      <div className="concept-grid">
        <Card className="concept-prompt-card">
          <label htmlFor="concept-topic">What do you need to explain?</label>
          <textarea
            id="concept-topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="e.g. Explain React reconciliation, or give me a STAR story about modernizing a legacy workflow."
            rows={8}
          />
          <p>
            Use a concept, system-design topic, behavioural prompt, or
            experience question.
          </p>
        </Card>

        <Card className="concept-preview-card">
          <div className="concept-preview-header">
            <div>
              <span>{savedId ? "SAVED BRIEFING" : "MARKDOWN BRIEFING"}</span>
              <strong>{title || "Ready when you are"}</strong>
            </div>
          </div>
          <article className="markdown concept-markdown">
            {markdown ? (
              <MarkdownContent>{markdown}</MarkdownContent>
            ) : (
              <div className="empty">
                <strong>Build a clear answer you can say out loud.</strong>
                <span>
                  Talking points and useful workflows will appear here.
                </span>
              </div>
            )}
          </article>
        </Card>
      </div>

      {followUps.length ? (
        <section
          className="concept-follow-up-list"
          aria-label="Follow-up answers"
        >
          {followUps.map((followUp, index) => {
            const open = openFollowUps.includes(index);
            const contentId = `concept-follow-up-${index}`;
            return (
              <Card
                className="concept-follow-up-panel"
                key={`${followUp.topic}-${index}`}
              >
                <button
                  type="button"
                  className="concept-follow-up-trigger"
                  aria-expanded={open}
                  aria-controls={contentId}
                  onClick={() =>
                    setOpenFollowUps((current) =>
                      current.includes(index)
                        ? current.filter((item) => item !== index)
                        : [...current, index],
                    )
                  }
                >
                  <span>
                    <small>Follow-up {index + 1}</small>
                    <strong>{followUp.title}</strong>
                  </span>
                  <span
                    className="concept-follow-up-chevron"
                    aria-hidden="true"
                  >
                    {open ? "−" : "+"}
                  </span>
                </button>
                {open ? (
                  <article
                    id={contentId}
                    className="markdown concept-markdown concept-follow-up-content"
                  >
                    <MarkdownContent>{followUp.markdown}</MarkdownContent>
                  </article>
                ) : null}
              </Card>
            );
          })}
        </section>
      ) : null}

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
                  <span>{new Date(item.updatedAt).toLocaleDateString()}</span>
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
    </section>
  );
}
