// The interview's context, entered in the native app: the company, the role,
// the job spec and the owner's notes, kept on the candidacy, and the employer
// brief the model cleans them into (what a live answer leans on). Library
// components only; the modal portals to the body (a library surface, so the
// shell's hit regions cover it).
import {
  Button,
  Input,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Textarea,
} from "@oc-tech/omni-ui-components";
import type {
  CandidacyContext,
  EmployerBrief,
} from "@omnitech/interview-contracts";
import { useEffect, useState } from "react";
import { documentJson, postJson } from "../../../documents/documents-client";

type Draft = {
  companyName: string;
  title: string;
  jobDescription: string;
  notes: string;
};

const EMPTY: Draft = {
  companyName: "",
  title: "",
  jobDescription: "",
  notes: "",
};

// The brief by section, each a heading and its items: what the owner checks
// the clean-up against before trusting it in a session.
export function briefSections(
  brief: EmployerBrief,
): { heading: string; items: string[] }[] {
  const section = (heading: string, items: readonly string[]) =>
    items.length ? [{ heading, items: [...items] }] : [];
  return [
    ...section("About the company", brief.companyFacts ?? []),
    ...section("Your prep", brief.prepNotes ?? []),
    ...section("Summary", brief.summary ? [brief.summary] : []),
    ...section("Must-haves", brief.mustHaves),
    ...section("Nice-to-haves", brief.niceToHaves),
    ...section("Tech stack", brief.techStack),
    ...section("Responsibilities", brief.responsibilities),
    ...section("Team", brief.team ? [brief.team] : []),
    ...section("Values", brief.values),
    ...section(
      "Interview format",
      brief.interviewFormat ? [brief.interviewFormat] : [],
    ),
    ...section("Questions to ask", brief.questionsToAsk),
  ];
}

export function InterviewContextModal({
  open,
  candidacyId,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  // null: a new interview is being added.
  candidacyId: string | null;
  onOpenChange(open: boolean): void;
  // The candidacy as saved (created or updated), so the caller can select it.
  onSaved(context: CandidacyContext): void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [current, setCurrent] = useState<CandidacyContext | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "brief" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Opening on an existing candidacy reads it; opening for a new one starts
  // blank. Nothing is kept between opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!candidacyId) {
      setDraft(EMPTY);
      setCurrent(null);
      return;
    }
    let live = true;
    setBusy("load");
    documentJson<CandidacyContext>(
      `/candidacies/${encodeURIComponent(candidacyId)}/context`,
    ).then(
      (context) => {
        if (!live) return;
        setCurrent(context);
        setDraft({
          companyName: context.companyName,
          title: context.title,
          jobDescription: context.jobDescription ?? "",
          notes: context.notes ?? "",
        });
        setBusy(null);
      },
      () => {
        if (!live) return;
        setError("The interview could not be read. Try again.");
        setBusy(null);
      },
    );
    return () => {
      live = false;
    };
  }, [open, candidacyId]);

  const canSave =
    draft.companyName.trim() !== "" && draft.title.trim() !== "" && !busy;

  // Save creates the candidacy (with one interview stage, so it can be started
  // for) or updates the existing one's title, spec and notes.
  async function save(): Promise<CandidacyContext | null> {
    setBusy("save");
    setError(null);
    try {
      let id = current?.id ?? null;
      if (!id) {
        const made = await postJson<{ candidacyId: string }>("/candidacies", {
          companyName: draft.companyName.trim(),
          title: draft.title.trim(),
          ...(draft.jobDescription.trim()
            ? { jobDescription: draft.jobDescription }
            : {}),
          interview: { kind: "other", label: "Interview" },
        });
        id = made.candidacyId;
      }
      const saved = await documentJson<CandidacyContext>(
        `/candidacies/${encodeURIComponent(id)}/context`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: draft.title.trim(),
            jobDescription: draft.jobDescription,
            notes: draft.notes,
          }),
        },
      );
      setCurrent(saved);
      onSaved(saved);
      return saved;
    } catch {
      setError("Saving did not go through. Nothing changed; try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  // Clean up: save first (the brief is built from what is stored), then ask
  // the model for the brief.
  async function cleanUp() {
    const saved = await save();
    if (!saved) return;
    setBusy("brief");
    try {
      const briefed = await postJson<CandidacyContext>(
        `/candidacies/${encodeURIComponent(saved.id)}/brief`,
        {},
      );
      setCurrent(briefed);
      onSaved(briefed);
    } catch {
      setError("The clean-up did not finish. The spec is saved; try again.");
    } finally {
      setBusy(null);
    }
  }

  const sections = current?.brief ? briefSections(current.brief) : [];
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        className="pn-context-modal"
        data-testid="pn-context-modal"
        aria-busy={busy !== null}
      >
        <ModalHeader>
          <ModalTitle>
            {candidacyId ? "Interview context" : "Add an interview"}
          </ModalTitle>
          <ModalDescription>
            The company and role this session is for, the job spec, and your
            notes. Clean up with AI turns them into a short employer brief the
            answers lean on. Nothing here is treated as your experience.
          </ModalDescription>
        </ModalHeader>
        <div className="pn-context-fields">
          <Input
            label="Company"
            value={draft.companyName}
            onChange={(companyName) => setDraft({ ...draft, companyName })}
            disabled={busy !== null || current !== null}
            required
            data-testid="pn-context-company"
          />
          <Input
            label="Role"
            value={draft.title}
            onChange={(title) => setDraft({ ...draft, title })}
            disabled={busy !== null}
            required
            data-testid="pn-context-role"
          />
          {/* The concise brief leads: it is what a live answer reads. The raw
              posting, long and untidy, is the source beneath it. */}
          {sections.length > 0 && (
            <section
              className="pn-context-brief"
              aria-label="Employer brief"
              data-testid="pn-context-brief"
            >
              <h4>The concise brief · what the answers lean on</h4>
              {sections.map((part) => (
                <div key={part.heading} className="pn-context-brief-part">
                  <h5>{part.heading}</h5>
                  <ul>
                    {part.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
          <Textarea
            label="Your notes"
            description="What you know about the team, the interviewer, the process."
            rows={4}
            value={draft.notes}
            onChange={(notes) => setDraft({ ...draft, notes })}
            disabled={busy !== null}
            data-testid="pn-context-notes"
          />
          <Textarea
            label="Job spec (the raw posting)"
            description="Paste the posting as it is; the clean-up reads it, you do not have to tidy it."
            rows={4}
            value={draft.jobDescription}
            onChange={(jobDescription) =>
              setDraft({ ...draft, jobDescription })
            }
            disabled={busy !== null}
            data-testid="pn-context-spec"
          />
          {error && (
            <p className="pn-context-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <ModalFooter>
          <Button
            variant="outline"
            buttonSize="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy !== null}
          >
            Close
          </Button>
          <Button
            variant="outline"
            buttonSize="sm"
            loading={busy === "save"}
            disabled={!canSave}
            onClick={() => void save()}
            data-testid="pn-context-save"
          >
            Save
          </Button>
          <Button
            buttonSize="sm"
            loading={busy === "brief"}
            disabled={!canSave || draft.jobDescription.trim() === ""}
            onClick={() => void cleanUp()}
            data-testid="pn-context-clean"
          >
            {current?.brief ? "Clean up again" : "Clean up with AI"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
