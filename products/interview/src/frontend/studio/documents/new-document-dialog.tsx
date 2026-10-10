"use client";

import {
  Alert,
  Flex,
  Input,
  SplitButton,
  Textarea,
  Typography,
} from "@oc-tech/omni-ui-components";
import type { DocumentField } from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icon";
import { useLeaveGuard } from "../work-guards";
import { documentTarget } from "./assistant-model";
import {
  type CreationMode,
  loadCreationMode,
  saveCreationMode,
} from "./creation-mode";
import type { PreviewPayload } from "./document-preview";
import { type WritingBatch, WritingView } from "./document-writing";
import {
  type DocumentContext,
  type DocumentListItem,
  DocumentsApiError,
  documentJson,
  postJson,
  postStream,
  type TemplateDetail,
  type TemplateListItem,
} from "./documents-client";
import { KIND_ICON, KIND_LABEL } from "./documents-model";
import { Actions, Modal, message } from "./documents-ui";

// "New application" is a choice in the list, made real when generating.
const NEW_APPLICATION = "__new";
const NEW_STAGE = "new:";
const STAGE_PRESETS = [
  ["recruiter_screen", "Recruiter screen"],
  ["hiring_manager", "Hiring manager"],
  ["technical", "Technical"],
  ["system_design", "System design"],
  ["panel", "Panel"],
  ["final", "Final"],
] as const;

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function NewDocumentDialog({
  context,
  templates,
  documents,
  initial,
  onClose,
  onCreated,
  onOpenExisting,
}: {
  context: DocumentContext;
  templates: readonly TemplateListItem[];
  documents: readonly DocumentListItem[];
  initial: { candidacyId: string | null; templateId?: string };
  onClose(): void;
  onCreated(documentId: string): void;
  onOpenExisting(documentId: string): void;
}) {
  const [templateId, setTemplateId] = useState(
    initial.templateId ?? templates[0]?.template.id ?? "",
  );
  const [candidacyId, setCandidacyId] = useState(initial.candidacyId ?? "");
  const [interviewId, setInterviewId] = useState(
    () =>
      context.interviews.find(
        (item) => item.candidacy_id === initial.candidacyId,
      )?.id ?? "",
  );
  const [jobDescription, setJobDescription] = useState(
    () =>
      context.candidacies.find((item) => item.id === initial.candidacyId)
        ?.job_description ?? "",
  );
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [profileId, setProfileId] = useState(context.profiles[0]?.id ?? "");
  // Generation follows the assistant's model; it is not chosen here.
  const [resolution] = useState(() => documentTarget(context.targets));
  const targetId = resolution.target?.id ?? "";
  // Written by the model or made by hand: the choice last used in this browser.
  const [mode, setMode] = useState<CreationMode>(loadCreationMode);
  const manual = mode === "manual";
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  // The document as it is written: sections ticking off, values arriving.
  const [writing, setWriting] = useState<{
    batches: WritingBatch[] | null;
    fields: DocumentField[];
    preview: PreviewPayload | null;
    finished: boolean;
  } | null>(null);
  const written = useRef<Record<string, string>>({});
  const drawTimer = useRef<number | undefined>(undefined);
  const drawing = useRef(0);
  useEffect(
    () => () => {
      pending.current?.abort();
      window.clearTimeout(drawTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!busy) return;
    setSeconds(0);
    const timer = window.setInterval(
      () => setSeconds((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  // Leaving while a document is being written cancels it, so ask first.
  useLeaveGuard(busy);

  const selected = templates.find((item) => item.template.id === templateId);
  const profile = context.profiles.find((item) => item.id === profileId);
  const isNew = candidacyId === NEW_APPLICATION;
  const candidacy = context.candidacies.find((item) => item.id === candidacyId);
  const interviews = context.interviews.filter(
    (item) => item.candidacy_id === candidacyId,
  );
  // A stage is one the application has, or a common one made on generate.
  const presets = STAGE_PRESETS.filter(
    ([, label]) =>
      !interviews.some(
        (item) => item.label.toLowerCase() === label.toLowerCase(),
      ),
  );
  const stages = [
    ...interviews.map((item) => ({ id: item.id, label: item.label })),
    ...presets.map(([kind, label]) => ({ id: `${NEW_STAGE}${kind}`, label })),
  ];
  const needsStage = selected?.template.kind === "interview_prep";
  // Prep is for one stage: the one picked, else the application's first, else
  // the most common one to prepare for.
  const stage =
    stages.find((item) => item.id === interviewId) ??
    (needsStage
      ? (stages.find((item) => item.id === `${NEW_STAGE}hiring_manager`) ??
        stages[0])
      : undefined);
  const hasApplication = isNew
    ? !!company.trim() && !!role.trim()
    : !!candidacy;
  const companyName = isNew ? company.trim() : candidacy?.company_name;
  // A document made by hand needs no model, so none has to be available.
  const canCreate =
    !!selected &&
    !!profile &&
    (manual || !!targetId) &&
    (candidacyId === "" || hasApplication) &&
    (!needsStage || (hasApplication && !!stage));
  const existingStageId =
    needsStage && stage && !stage.id.startsWith(NEW_STAGE) ? stage.id : null;
  const title = selected
    ? `${selected.template.name} — ${companyName || "general"}${
        needsStage && stage ? ` · ${stage.label}` : ""
      }`
    : "New document";
  const duplicate = isNew
    ? undefined
    : documents.find(
        (item) =>
          item.templateId === templateId &&
          item.templateRevision === selected?.latestRevision &&
          item.profileId === profileId &&
          item.profileRevision === profile?.revision &&
          item.candidacyId === (candidacy?.id ?? null) &&
          item.interviewId === existingStageId,
      );

  function chooseCandidacy(id: string) {
    setCandidacyId(id);
    const first = context.interviews.find((item) => item.candidacy_id === id);
    setInterviewId(
      first?.id ?? (id ? `${NEW_STAGE}${STAGE_PRESETS[1][0]}` : ""),
    );
    setJobDescription(
      context.candidacies.find((item) => item.id === id)?.job_description ?? "",
    );
  }

  function chooseMode(next: CreationMode) {
    setMode(next);
    saveCreationMode(next);
    setError("");
  }

  async function create() {
    if (!selected || !profile || !canCreate) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setExistingId(null);
    try {
      let applicationId = candidacy?.id ?? null;
      let stageId = existingStageId;
      const newStage =
        needsStage && stage?.id.startsWith(NEW_STAGE)
          ? { kind: stage.id.slice(NEW_STAGE.length), label: stage.label }
          : undefined;
      if (isNew) {
        // The application is made first, so a failed generation still leaves
        // what the person typed.
        const made = await postJson<{
          candidacyId: string;
          interviewId: string | null;
        }>(
          "/candidacies",
          {
            companyName: company.trim(),
            title: role.trim(),
            ...(jobDescription.trim() ? { jobDescription } : {}),
            ...(newStage ? { interview: newStage } : {}),
          },
          controller.signal,
        );
        applicationId = made.candidacyId;
        stageId = made.interviewId;
      } else if (candidacy) {
        if (jobDescription !== (candidacy.job_description ?? ""))
          await documentJson(
            `/candidacies/${encodeURIComponent(candidacy.id)}/job-description`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ jobDescription }),
              signal: controller.signal,
            },
          );
        if (newStage)
          stageId = (
            await postJson<{ interviewId: string }>(
              `/candidacies/${encodeURIComponent(candidacy.id)}/interviews`,
              newStage,
              controller.signal,
            )
          ).interviewId;
      }
      const selection = {
        title,
        templateId,
        templateRevision: selected.latestRevision,
        profileId,
        profileRevision: profile.revision,
        candidacyId: applicationId,
        interviewId: stageId,
      };
      if (manual) {
        // Made by hand: one plain request, no model call and nothing to watch
        // being written. The document opens in the editor to be filled in.
        const made = await postJson<{ document: { id: string } }>(
          "",
          { ...selection, mode: "manual" },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        onCreated(made.document.id);
        return;
      }
      const body = { ...selection, aiTargetId: targetId };
      // Draw the empty document at once, then redraw as sections land.
      written.current = {};
      setWriting({ batches: null, fields: [], preview: null, finished: false });
      const draw = (delay: number) => {
        window.clearTimeout(drawTimer.current);
        drawTimer.current = window.setTimeout(async () => {
          const turn = ++drawing.current;
          try {
            const next = await postJson<PreviewPayload>(
              `/templates/${encodeURIComponent(templateId)}/preview`,
              { revision: selected.latestRevision, values: written.current },
              controller.signal,
            );
            if (turn === drawing.current)
              setWriting((now) => now && { ...now, preview: next });
          } catch {
            // A missed redraw only delays the picture; the document is saved
            // by the server whatever the browser shows.
          }
        }, delay);
      };
      draw(0);
      void documentJson<TemplateDetail>(
        `/templates/${encodeURIComponent(templateId)}?revision=${selected.latestRevision}`,
        { signal: controller.signal },
      ).then(
        (detail) =>
          setWriting((now) => now && { ...now, fields: detail.fields }),
        () => undefined,
      );
      let createdId: string | null = null;
      let failure: string | null = null;
      await postStream("", body, controller.signal, (event) => {
        if (event.t === "plan") {
          written.current = { ...written.current, ...event.fixed };
          setWriting(
            (now) =>
              now && {
                ...now,
                batches: event.batches.map((batch) => ({
                  ...batch,
                  done: false,
                })),
              },
          );
          draw(150);
        } else if (event.t === "batch") {
          written.current = { ...written.current, ...event.values };
          setWriting(
            (now) =>
              now && {
                ...now,
                batches:
                  now.batches?.map((batch) =>
                    batch.id === event.id ? { ...batch, done: true } : batch,
                  ) ?? null,
              },
          );
          draw(350);
        } else if (event.t === "done") createdId = event.document.id;
        else if (event.t === "exists") setExistingId(event.existingDocumentId);
        else failure = event.code;
      });
      if (failure) throw new DocumentsApiError(failure, null);
      if (!createdId) {
        setWriting(null);
        return;
      }
      // Let the finished document be seen before opening it.
      draw(0);
      setWriting((now) => now && { ...now, finished: true });
      const opened = createdId;
      await new Promise((resolve) => window.setTimeout(resolve, 1100));
      if (controller.signal.aborted) return;
      onCreated(opened);
    } catch (cause) {
      setWriting(null);
      if (controller.signal.aborted) return;
      const id =
        cause instanceof DocumentsApiError && cause.code === "request-failed"
          ? (cause.payload as { existingDocumentId?: string } | null)
              ?.existingDocumentId
          : undefined;
      const busyElsewhere =
        cause instanceof DocumentsApiError &&
        (cause.payload as { inProgress?: boolean } | null)?.inProgress;
      if (id) setExistingId(id);
      else if (busyElsewhere)
        setError(
          "This document is already being written in another window. It will be in your list when it is done.",
        );
      else setError(message(cause));
    } finally {
      if (pending.current === controller) pending.current = null;
      setBusy(false);
    }
  }

  const matchId = existingId ?? duplicate?.id ?? null;
  return (
    <Modal
      title="New document"
      width={writing ? 1180 : 640}
      onClose={() => {
        pending.current?.abort();
        onClose();
      }}
      footer={
        <>
          <Flex vertical style={{ flex: 1, minWidth: 0 }}>
            <Typography.Text>{title}</Typography.Text>
            <Typography.Text
              type={error ? "danger" : "secondary"}
              size="compact"
            >
              {error
                ? error
                : busy
                  ? manual
                    ? "Creating the document · no AI call"
                    : `${resolution.target?.label ?? "The model"} is writing ${selected?.fieldCount ?? ""} fields · ${clock(seconds)} · sections are written side by side`
                  : selected
                    ? `${selected.fieldCount} fields · ${selected.template.format.toUpperCase()} · ${
                        manual
                          ? "you write the fields · no AI call"
                          : "written in a few parallel calls"
                      }`
                    : "Choose a template"}
            </Typography.Text>
          </Flex>
          <Actions
            actions={[
              {
                id: "cancel",
                label: busy && !manual ? "Cancel generation" : "Cancel",
                size: "lg",
                onClick: () => {
                  pending.current?.abort();
                  onClose();
                },
              },
            ]}
          />
          <SplitButton
            tone="accent"
            main={{
              label: busy
                ? manual
                  ? "Creating…"
                  : "Generating…"
                : manual
                  ? "Create manually"
                  : "Generate with AI",
              icon: <Icon name={manual ? "edit" : "auto_awesome"} size={18} />,
              labelInline: true,
              state: busy ? "analysing" : "idle",
              disabled: busy || !canCreate,
              onPress: () => void create(),
            }}
            caret={{
              label: "Choose how the document is made",
              ...(busy ? { disabledReason: "The document is being made" } : {}),
            }}
            openMenuOn={["arrowdown"]}
            menu={{
              label: "How the document is made",
              // Inside the dialog, so it is drawn above the dialog's scrim.
              portal: false,
              side: "top",
              align: "end",
              sections: [
                {
                  id: "mode",
                  value: mode,
                  items: [
                    {
                      id: "ai",
                      label: "Generate with AI",
                      description: `${resolution.target?.label ?? "A model"} writes the fields in a few parallel calls`,
                    },
                    {
                      id: "manual",
                      label: "Create manually",
                      description:
                        "Opens with the application and matrix facts filled in; you write the rest. No AI call",
                    },
                  ],
                },
              ],
              onValueChange: (_section, id) =>
                chooseMode(id === "manual" ? "manual" : "ai"),
            }}
          />
        </>
      }
    >
      {writing ? (
        <WritingView
          title={title}
          model={resolution.target?.label ?? "The model"}
          batches={writing.batches}
          fields={writing.fields}
          preview={writing.preview}
          seconds={seconds}
          finished={writing.finished}
        />
      ) : (
        <>
          {templates.length === 0 && (
            <Alert variant="info" size="sm" role="status">
              No templates are available. Open Templates to add one.
            </Alert>
          )}
          {context.profiles.length === 0 && (
            <Alert variant="info" size="sm" role="status">
              Save an experience matrix before generating a document.
            </Alert>
          )}
          {context.targets.length === 0 && (
            <Alert variant="info" size="sm" role="status">
              No model is available for document generation.
              {manual ? " You can still create the document manually." : ""}
            </Alert>
          )}

          <section className="dx-step" aria-label="Template">
            <div className="dx-step-title">1 · Template</div>
            <div className="dx-tile-grid">
              {templates.map(({ template, fieldCount }) => (
                <button
                  key={template.id}
                  type="button"
                  className="dx-option"
                  aria-pressed={template.id === templateId}
                  onClick={() => {
                    setTemplateId(template.id);
                    // Prep is about one application: start on the first, or a
                    // new one when there are none.
                    if (template.kind === "interview_prep" && !candidacyId)
                      chooseCandidacy(
                        context.candidacies[0]?.id ?? NEW_APPLICATION,
                      );
                  }}
                >
                  <span className="dx-option-line">
                    <Icon name={KIND_ICON[template.kind]} size={18} />
                    <span className="dx-grow">{template.name}</span>
                  </span>
                  <span className="dx-sub">
                    {KIND_LABEL[template.kind]} ·{" "}
                    {template.format.toUpperCase()} · {fieldCount} fields ·{" "}
                    {template.ownerUserId ? "yours" : "built-in"}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="dx-step" aria-label="Application">
            <div className="dx-step-title">
              2 · Which application is it for?
            </div>
            <div
              className="dx-radio-list"
              role="radiogroup"
              aria-label="Application"
            >
              {[
                ...context.candidacies.map((item) => ({
                  id: item.id,
                  title: `${item.company_name} · ${item.title}`,
                  sub: "Company, role and job description come from this application",
                })),
                {
                  id: NEW_APPLICATION,
                  title: "New application",
                  sub: "Add the company and role you’re going for",
                },
                {
                  id: "",
                  title: "General — no application",
                  sub: needsStage
                    ? "Interview prep needs an application"
                    : "Built from your experience matrix only",
                },
              ].map((option) => {
                const disabled = needsStage && option.id === "";
                return (
                  // biome-ignore lint/a11y/useSemanticElements: a styled button is the radio here; a native input would change the element and its styling
                  <button
                    key={option.id || "general"}
                    type="button"
                    role="radio"
                    aria-checked={option.id === candidacyId}
                    disabled={disabled}
                    className="dx-option dx-radio"
                    onClick={() => chooseCandidacy(option.id)}
                  >
                    <span className="dx-radio-dot" aria-hidden="true" />
                    <span className="dx-grow">
                      <span className="dx-row-title">{option.title}</span>
                      <span className="dx-sub">{option.sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {isNew && (
              <div className="dx-two-up">
                <Input
                  label="Company"
                  value={company}
                  maxLength={200}
                  placeholder="Zensurance"
                  onChange={setCompany}
                />
                <Input
                  label="Role"
                  value={role}
                  maxLength={200}
                  placeholder="Tech Lead, Core / Payments"
                  onChange={setRole}
                />
              </div>
            )}
            {(candidacy || isNew) && profile && (
              <>
                {candidacy && (
                  <Flex align="center" gap={8}>
                    <Icon name="link" size={15} />
                    <Typography.Text type="secondary" size="compact">
                      Uses the {candidacy.company_name} job description and
                      role. Your {profile.name.toLowerCase()} (rev{" "}
                      {profile.revision}) is attached automatically.
                    </Typography.Text>
                  </Flex>
                )}
                <Textarea
                  label="Job description"
                  rows={4}
                  maxLength={20_000}
                  value={jobDescription}
                  onChange={setJobDescription}
                  placeholder="Paste the role's job description"
                  description={`Saved to this application when you ${
                    manual ? "create the document" : "generate"
                  }.`}
                />
              </>
            )}
          </section>

          {needsStage && (candidacy || isNew) && (
            <section className="dx-step" aria-label="Interview">
              <div className="dx-step-title">3 · Interview</div>
              <div className="dx-stage-chips">
                {stages.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="dx-option dx-stage"
                    aria-pressed={item.id === stage?.id}
                    onClick={() => setInterviewId(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="dx-settings">
            <label className="dx-setting">
              <Icon name="badge" size={17} />
              <span className="dx-setting-name">Experience</span>
              <select
                aria-label="Experience"
                className="dx-select"
                value={profileId}
                onChange={(event) => setProfileId(event.target.value)}
              >
                {context.profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · rev {item.revision}
                  </option>
                ))}
              </select>
            </label>
            <div className="dx-setting">
              <Icon name="neurology" size={17} />
              <span className="dx-setting-name">Model</span>
              <span className="dx-grow">
                <span className="dx-row-title">
                  {resolution.target?.label ?? "None available"}
                </span>
                <span className="dx-sub">
                  {resolution.skipped
                    ? "Your assistant's model can't write documents, so this one is used."
                    : "Follows the model chosen in the assistant."}
                </span>
              </span>
            </div>
          </div>

          {matchId && (
            <Alert variant="info" size="sm" role="status">
              <Flex align="center" gap={8} wrap="wrap">
                <Icon name="content_copy" size={16} />
                <Typography.Text size="compact">
                  {existingId
                    ? "A matching document already exists."
                    : `You already have “${duplicate?.title}”.`}
                </Typography.Text>
                <Actions
                  actions={[
                    {
                      id: "open",
                      label: "Open it",
                      size: "sm",
                      onClick: () => onOpenExisting(matchId),
                    },
                  ]}
                />
              </Flex>
            </Alert>
          )}
          {error && (
            <Alert variant="error" size="sm" role="alert">
              {error}
            </Alert>
          )}
        </>
      )}
    </Modal>
  );
}
