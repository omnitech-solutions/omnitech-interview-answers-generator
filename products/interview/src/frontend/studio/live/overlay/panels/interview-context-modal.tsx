// The interview's context, entered in the native app: the company, the role,
// the job spec and the owner's notes, kept on the candidacy, and the employer
// brief the model cleans them into (what a live answer leans on). Library
// components only; the modal portals to the body (a library surface, so the
// shell's hit regions cover it).
import {
  Alert,
  Button,
  FormActions,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@oc-tech/omni-ui-components";
import { DynamicForm } from "@oc-tech/omni-ui-components/dynamic-form";
import {
  type CandidacyContext,
  type CandidacyContextInput,
  candidacyContextInputSchema,
  type EmployerBrief,
} from "@omnitech/interview-contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { documentJson, postJson } from "../../../documents/documents-client";
import { InterviewBriefForm } from "../../../interview-brief/interview-brief-form";
import { formParser } from "../../../shared/contract-form";
import {
  contextFormSchema,
  contextUiSchema,
  toContextFormData,
  toContextInput,
} from "./interview-context-form";

const CONTEXT_PARSER = formParser(candidacyContextInputSchema);

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
  // What the form was last given to start from, and a count that remounts it
  // when that changes (the form keeps its own values once it is typed in).
  const [seed, setSeed] = useState({ at: 0, values: toContextFormData(null) });
  // What the form holds now: it decides which actions can be pressed.
  const [draft, setDraft] = useState<Record<string, unknown>>(seed.values);
  const [current, setCurrent] = useState<CandidacyContext | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "brief" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which of the form's two submit buttons was pressed.
  const intent = useRef<"save" | "clean">("save");

  // Opening on an existing candidacy reads it; opening for a new one starts
  // blank. Nothing is kept between opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    const start = (context: CandidacyContext | null) => {
      const values = toContextFormData(context);
      setCurrent(context);
      setDraft(values);
      setSeed((last) => ({ at: last.at + 1, values }));
    };
    if (!candidacyId) {
      start(null);
      return;
    }
    let live = true;
    setBusy("load");
    documentJson<CandidacyContext>(
      `/candidacies/${encodeURIComponent(candidacyId)}/context`,
    ).then(
      (context) => {
        if (!live) return;
        start(context);
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

  // Save can be pressed once the contract would take what is typed (a company
  // and a role); the server's own check of the same contract is the authority.
  const input = toContextInput(draft);
  const canSave = input !== null && !busy;
  const uiSchema = useMemo(
    () => contextUiSchema({ companyFixed: current !== null }),
    [current],
  );

  // Save creates the candidacy (with one interview stage, so it can be started
  // for) or updates the existing one's title, spec and notes.
  async function save(
    typed: CandidacyContextInput,
  ): Promise<CandidacyContext | null> {
    setBusy("save");
    setError(null);
    try {
      let id = current?.id ?? null;
      if (!id) {
        const made = await postJson<{ candidacyId: string }>("/candidacies", {
          companyName: typed.companyName,
          title: typed.title,
          ...(typed.jobDescription.trim()
            ? { jobDescription: typed.jobDescription }
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
            title: typed.title,
            jobDescription: typed.jobDescription,
            notes: typed.notes,
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
  async function cleanUp(typed: CandidacyContextInput) {
    const saved = await save(typed);
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

  // The form hands over what it holds; the contract reads it (trimmed) before
  // anything is sent.
  async function submit(values: unknown) {
    const typed = toContextInput(values);
    if (!typed) return;
    await (intent.current === "clean" ? cleanUp(typed) : save(typed));
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
          <DynamicForm
            key={seed.at}
            schema={contextFormSchema}
            uiSchema={uiSchema}
            zodSchema={CONTEXT_PARSER}
            formData={seed.values}
            disabled={busy !== null}
            onChange={setDraft}
            onSubmit={submit}
          >
            {error && <Alert variant="error" title={error} />}
            <FormActions>
              <Button
                type="submit"
                variant="outline"
                buttonSize="sm"
                loading={busy === "save"}
                disabled={!canSave}
                onClick={() => {
                  intent.current = "save";
                }}
                data-testid="pn-context-save"
              >
                Save
              </Button>
              <Button
                type="submit"
                buttonSize="sm"
                loading={busy === "brief"}
                disabled={!canSave || input?.jobDescription.trim() === ""}
                onClick={() => {
                  intent.current = "clean";
                }}
                data-testid="pn-context-clean"
              >
                {current?.brief ? "Clean up again" : "Clean up with AI"}
              </Button>
            </FormActions>
          </DynamicForm>
          {/* The interview's stages, what the employer said and the research:
              kept per application, so they appear once it is saved. */}
          {current && <InterviewBriefForm candidacyId={current.id} />}
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
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
