// The Interview form's stages, "Employer said" and "Research": everything a
// person has for one application beyond its company, role and posting.
//
// Each stage is its own section: who is met, when, for how long and how; the
// person's notes for it; its transcripts (pasted, uploaded, or the one the
// Studio just recorded); and afterwards its outcome. Stages are added,
// reordered and removed here, a removal confirmed in place. Every write goes
// to the server and the form shows what the server answers with.
// Library parts only: no markup or style of this product's own.
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapse,
  FileUpload,
  Flex,
  Input,
  Popconfirm,
  Select,
  Tag,
  Textarea,
  Typography,
} from "@oc-tech/omni-ui-components";
import {
  INTERVIEW_BRIEF_BOUNDS,
  INTERVIEW_STAGE_FORMATS,
  INTERVIEW_STAGE_KINDS,
  INTERVIEW_STAGE_STATUSES,
  type InterviewBrief,
  type InterviewStage,
  STAGE_PERSON_ROLES,
  type StagePersonInput,
  type StageRecording,
  type StageTranscript,
  type StageUpdate,
  type TranscriptPolicy,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useState } from "react";
import { DocumentsApiError } from "../documents/documents-client";
import { EmployerSaidList, ResearchList } from "./brief-lists";
import { interviewBriefClient } from "./interview-brief-client";
import { PackReviewSection } from "./pack-review";

const words = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
const options = (values: readonly string[]) =>
  values.map((value) => ({ value, label: words(value) }));
const NOT_SET = "none";

const POLICY_LABEL: Record<TranscriptPolicy, string> = {
  "device-only": "Stays on this device",
  "permitted-remote": "May be read by a remote model",
};
const POLICIES = (Object.keys(POLICY_LABEL) as TranscriptPolicy[]).map(
  (value) => ({ value, label: POLICY_LABEL[value] }),
);
const ORIGIN_LABEL: Record<StageTranscript["origin"], string> = {
  recorded: "Recorded by the Studio",
  uploaded: "Uploaded",
  pasted: "Pasted",
};

// What each refusal means to the person, in their words.
const REFUSAL: Record<string, string> = {
  "body-too-large": "That is larger than this form takes.",
  "limit-reached": "There is no room for another one here.",
  "invalid-transcript":
    "That is not a transcript this form can read: nothing was said in it, or it is not text.",
  "unsupported-format": "That kind of file is not read here.",
  "stage-in-use":
    "A live session or a document was made for this stage, so it is kept.",
  "loosening-refused":
    "It was recorded under a device-only policy, so it stays on this device.",
  "nothing-to-carry": "There is nothing left to move.",
  "invalid-request": "Something in that was not accepted. Nothing changed.",
};
const refusalOf = (error: unknown) =>
  (error instanceof DocumentsApiError && REFUSAL[error.code]) ||
  "That did not go through. Nothing changed; try again.";

// An instant as the date-and-time field holds it (this machine's own time).
const toField = (iso: string | null) => {
  if (!iso) return "";
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
};
const fromField = (value: string) =>
  value ? new Date(value).toISOString() : null;

type Run = (work: () => Promise<InterviewBrief | undefined>) => Promise<void>;

function Transcripts({
  candidacyId,
  stage,
  busy,
  run,
}: {
  candidacyId: string;
  stage: InterviewStage;
  busy: boolean;
  run: Run;
}) {
  const [text, setText] = useState("");
  const [policy, setPolicy] = useState<TranscriptPolicy>("device-only");
  const [recordings, setRecordings] = useState<StageRecording[] | null>(null);
  // After a transcript is added the brief is read again, so the stage shows it.
  const added = (work: () => Promise<unknown>) =>
    run(async () => {
      await work();
      return interviewBriefClient.read(candidacyId);
    });
  return (
    <Flex vertical gap={8} data-testid="ib-transcripts">
      <Typography.Text>Transcripts</Typography.Text>
      {stage.transcripts.length === 0 && (
        <Typography.Text type="secondary">
          None yet. Add what was actually said once the stage is over.
        </Typography.Text>
      )}
      {stage.transcripts.map((transcript) => (
        <Flex
          key={transcript.id}
          gap={8}
          align="center"
          justify="space-between"
          wrap="wrap"
          data-testid="ib-transcript-row"
        >
          <Flex vertical gap={4}>
            <Typography.Text>{transcript.title}</Typography.Text>
            <Flex gap={4} wrap="wrap">
              <Tag>{ORIGIN_LABEL[transcript.origin]}</Tag>
              <Tag>{transcript.turns} turns</Tag>
              <Tag data-testid="ib-transcript-policy">
                {POLICY_LABEL[transcript.capturePolicy]}
              </Tag>
            </Flex>
          </Flex>
          <Flex gap={4} align="center">
            {/* A recording made under a device-only policy keeps it. */}
            {!(
              transcript.origin === "recorded" &&
              transcript.capturePolicy === "device-only"
            ) && (
              <Select
                aria-label={`Where "${transcript.title}" may be read`}
                value={transcript.capturePolicy}
                options={POLICIES}
                disabled={busy}
                onChange={(next) =>
                  void added(() =>
                    interviewBriefClient.setTranscriptPolicy(
                      candidacyId,
                      stage.id,
                      transcript.id,
                      next as TranscriptPolicy,
                    ),
                  )
                }
                data-testid="ib-transcript-policy-select"
              />
            )}
            <Popconfirm
              title={`Remove "${transcript.title}"?`}
              description="The transcript is deleted from this stage. This cannot be undone."
              confirmText="Remove"
              cancelText="Keep"
              onConfirm={() =>
                void run(() =>
                  interviewBriefClient.removeTranscript(
                    candidacyId,
                    stage.id,
                    transcript.id,
                  ),
                )
              }
            >
              <Button
                buttonSize="sm"
                variant="ghost"
                disabled={busy}
                data-testid="ib-transcript-remove"
              >
                Remove
              </Button>
            </Popconfirm>
          </Flex>
        </Flex>
      ))}
      <Textarea
        label="Paste a transcript"
        description="Timed blocks, WebVTT or SRT, lines that start with the speaker's name, or plain text."
        rows={3}
        value={text}
        onChange={setText}
        disabled={busy}
        data-testid="ib-transcript-text"
      />
      <Flex gap={8} align="end" wrap="wrap">
        <Select
          label="A pasted or uploaded transcript"
          value={policy}
          options={POLICIES}
          disabled={busy}
          onChange={(next) => setPolicy(next as TranscriptPolicy)}
          data-testid="ib-transcript-new-policy"
        />
        <Button
          buttonSize="sm"
          variant="outline"
          disabled={busy || text.trim() === ""}
          onClick={() =>
            void added(async () => {
              await interviewBriefClient.pasteTranscript(
                candidacyId,
                stage.id,
                { text, capturePolicy: policy },
              );
              setText("");
            })
          }
          data-testid="ib-transcript-paste"
        >
          Add pasted transcript
        </Button>
        <FileUpload
          label="Or upload a file (.txt, .vtt, .srt)"
          accept=".txt,.vtt,.srt,text/plain,text/vtt"
          maxSize={INTERVIEW_BRIEF_BOUNDS.transcriptUploadBytes}
          value={null}
          disabled={busy}
          onChange={(files) => {
            const [file] = files;
            if (file)
              void added(() =>
                interviewBriefClient.uploadTranscript(
                  candidacyId,
                  stage.id,
                  file,
                  policy,
                ),
              );
          }}
          data-testid="ib-transcript-upload"
        />
        <Button
          buttonSize="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setRecordings(
                (await interviewBriefClient.recordings(candidacyId)).recordings,
              );
              return undefined;
            })
          }
          data-testid="ib-recordings-open"
        >
          Attach the transcript I just recorded
        </Button>
      </Flex>
      {recordings !== null && (
        <Flex vertical gap={8} data-testid="ib-recordings">
          {recordings.length === 0 && (
            <Typography.Text type="secondary">
              The Studio has no recording of yours. Record one from a live
              session with Record transcript.
            </Typography.Text>
          )}
          {recordings.map((recording) => (
            <Flex
              key={recording.file}
              gap={8}
              align="center"
              justify="space-between"
              wrap="wrap"
              data-testid="ib-recording-row"
            >
              <Flex gap={4} wrap="wrap" align="center">
                <Typography.Text>
                  {new Date(recording.startedAt).toLocaleString()}
                </Typography.Text>
                <Tag>{POLICY_LABEL[recording.capturePolicy]}</Tag>
                {recording.attached && <Tag>Attached</Tag>}
              </Flex>
              <Button
                buttonSize="sm"
                variant="outline"
                disabled={busy || recording.attached}
                onClick={() =>
                  void added(async () => {
                    await interviewBriefClient.attachRecording(
                      candidacyId,
                      stage.id,
                      recording.file,
                    );
                    setRecordings(null);
                  })
                }
                data-testid="ib-recording-attach"
              >
                Attach to this stage
              </Button>
            </Flex>
          ))}
        </Flex>
      )}
    </Flex>
  );
}

let keys = 0;
const nextKey = () => {
  keys += 1;
  return keys;
};
type StageDraft = {
  label: string;
  kind: string;
  when: string;
  minutes: string;
  format: string;
  status: string;
  notes: string;
  outcome: string;
  nextSteps: string;
  // `key` is a row's identity on screen while it is being typed.
  people: { key: number; name: string; title: string; role: string }[];
};
const draftOf = (stage: InterviewStage): StageDraft => ({
  label: stage.label,
  kind: stage.kind,
  when: toField(stage.scheduledAt),
  minutes: stage.durationMinutes === null ? "" : String(stage.durationMinutes),
  format: stage.format ?? NOT_SET,
  status: stage.status,
  notes: stage.notes ?? "",
  outcome: stage.outcome ?? "",
  nextSteps: stage.nextSteps ?? "",
  people: stage.people.map(({ name, title, role }) => ({
    key: nextKey(),
    name,
    title: title ?? "",
    role,
  })),
});
// The stage as the server takes it. A person with no name is not one.
function updateOf(draft: StageDraft): StageUpdate {
  const minutes = Number.parseInt(draft.minutes, 10);
  return {
    label: draft.label.trim(),
    kind: draft.kind as StageUpdate["kind"],
    status: draft.status as StageUpdate["status"],
    format:
      draft.format === NOT_SET ? null : (draft.format as StageUpdate["format"]),
    scheduledAt: fromField(draft.when),
    durationMinutes: Number.isNaN(minutes) ? null : minutes,
    notes: draft.notes,
    outcome: draft.outcome,
    nextSteps: draft.nextSteps,
    people: draft.people
      .filter((person) => person.name.trim() !== "")
      .map(
        (person): StagePersonInput => ({
          name: person.name.trim(),
          ...(person.title.trim() ? { title: person.title.trim() } : {}),
          role: person.role as NonNullable<StagePersonInput["role"]>,
        }),
      ),
  };
}

function StageSection({
  candidacyId,
  stage,
  count,
  busy,
  run,
  move,
}: {
  candidacyId: string;
  stage: InterviewStage;
  count: number;
  busy: boolean;
  run: Run;
  move(by: -1 | 1): void;
}) {
  const [draft, setDraft] = useState(() => draftOf(stage));
  // What the server answers with is what the section shows.
  useEffect(() => setDraft(draftOf(stage)), [stage]);
  const set = (patch: Partial<StageDraft>) => setDraft({ ...draft, ...patch });
  const person = (at: number, patch: Partial<StageDraft["people"][number]>) =>
    set({
      people: draft.people.map((each, index) =>
        index === at ? { ...each, ...patch } : each,
      ),
    });
  const minutes = Number.parseInt(draft.minutes, 10);
  const valid =
    draft.label.trim() !== "" &&
    (draft.minutes === "" || (minutes >= 5 && minutes <= 480));
  return (
    <Flex vertical gap={12} data-testid="ib-stage">
      <Flex gap={8} wrap="wrap">
        <Input
          label="Stage"
          value={draft.label}
          onChange={(label) => set({ label })}
          disabled={busy}
          required
          data-testid="ib-stage-label"
        />
        <Select
          label="Kind"
          value={draft.kind}
          options={options(INTERVIEW_STAGE_KINDS)}
          onChange={(kind) => set({ kind })}
          disabled={busy}
          data-testid="ib-stage-kind"
        />
        <Select
          label="Status"
          value={draft.status}
          options={options(INTERVIEW_STAGE_STATUSES)}
          onChange={(status) => set({ status })}
          disabled={busy}
          data-testid="ib-stage-status"
        />
      </Flex>
      <Flex gap={8} wrap="wrap">
        <Input
          label="When"
          type="datetime-local"
          value={draft.when}
          onChange={(when) => set({ when })}
          disabled={busy}
          data-testid="ib-stage-when"
        />
        <Input
          label="Minutes"
          type="number"
          min={5}
          max={480}
          value={draft.minutes}
          onChange={(value) => set({ minutes: value })}
          disabled={busy}
          {...(draft.minutes !== "" && !valid
            ? { error: "Between 5 and 480." }
            : {})}
          data-testid="ib-stage-minutes"
        />
        <Select
          label="Format"
          value={draft.format}
          options={[
            { value: NOT_SET, label: "Not set" },
            ...options(INTERVIEW_STAGE_FORMATS),
          ]}
          onChange={(format) => set({ format })}
          disabled={busy}
          data-testid="ib-stage-format"
        />
      </Flex>

      <Flex vertical gap={8} data-testid="ib-people">
        <Typography.Text>People you will meet</Typography.Text>
        {draft.people.map((each, at) => (
          <Flex
            key={each.key}
            gap={8}
            align="end"
            wrap="wrap"
            data-testid="ib-person"
          >
            <Input
              label="Name"
              value={each.name}
              onChange={(name) => person(at, { name })}
              disabled={busy}
              data-testid="ib-person-name"
            />
            <Input
              label="Title"
              value={each.title}
              onChange={(title) => person(at, { title })}
              disabled={busy}
              data-testid="ib-person-title"
            />
            <Select
              label="Role"
              value={each.role}
              options={options(STAGE_PERSON_ROLES)}
              onChange={(role) => person(at, { role })}
              disabled={busy}
              data-testid="ib-person-role"
            />
            <Button
              buttonSize="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                set({
                  people: draft.people.filter((_, index) => index !== at),
                })
              }
              data-testid="ib-person-remove"
            >
              Remove
            </Button>
          </Flex>
        ))}
        <Flex>
          <Button
            buttonSize="sm"
            variant="outline"
            disabled={
              busy ||
              draft.people.length >= INTERVIEW_BRIEF_BOUNDS.peoplePerStage
            }
            onClick={() =>
              set({
                people: [
                  ...draft.people,
                  { key: nextKey(), name: "", title: "", role: "interviewer" },
                ],
              })
            }
            data-testid="ib-person-add"
          >
            Add a person
          </Button>
        </Flex>
      </Flex>

      {stage.offeredNotes !== null && (
        <Flex vertical gap={8} data-testid="ib-offered-notes">
          <Alert variant="info" title="Your notes for the whole application">
            They were written before stages had notes of their own, and are
            offered here until you move them. {stage.offeredNotes.length}{" "}
            characters.
          </Alert>
          <Flex>
            <Button
              buttonSize="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(() => interviewBriefClient.moveNotes(candidacyId))
              }
              data-testid="ib-notes-move"
            >
              Move them to this stage
            </Button>
          </Flex>
        </Flex>
      )}
      <Textarea
        label="Your notes for this stage"
        description="What you prepared: one line per question you expect, with the proof you will name."
        rows={5}
        maxLength={INTERVIEW_BRIEF_BOUNDS.notesChars}
        value={draft.notes}
        onChange={(notes) => set({ notes })}
        disabled={busy}
        data-testid="ib-stage-notes"
      />

      <Transcripts
        candidacyId={candidacyId}
        stage={stage}
        busy={busy}
        run={run}
      />

      <Textarea
        label="Outcome"
        description="What happened."
        rows={2}
        maxLength={INTERVIEW_BRIEF_BOUNDS.outcomeChars}
        value={draft.outcome}
        onChange={(outcome) => set({ outcome })}
        disabled={busy}
        data-testid="ib-stage-outcome"
      />
      <Textarea
        label="What comes next"
        rows={2}
        maxLength={INTERVIEW_BRIEF_BOUNDS.nextStepsChars}
        value={draft.nextSteps}
        onChange={(nextSteps) => set({ nextSteps })}
        disabled={busy}
        data-testid="ib-stage-next"
      />

      <Flex gap={8} wrap="wrap" justify="space-between">
        <Flex gap={8} wrap="wrap">
          <Button
            buttonSize="sm"
            disabled={busy || !valid}
            onClick={() =>
              void run(() =>
                interviewBriefClient.updateStage(
                  candidacyId,
                  stage.id,
                  updateOf(draft),
                ),
              )
            }
            data-testid="ib-stage-save"
          >
            Save stage
          </Button>
          <Button
            buttonSize="sm"
            variant="outline"
            disabled={busy || stage.ordinal === 1}
            onClick={() => move(-1)}
            data-testid="ib-stage-up"
          >
            Move earlier
          </Button>
          <Button
            buttonSize="sm"
            variant="outline"
            disabled={busy || stage.ordinal === count}
            onClick={() => move(1)}
            data-testid="ib-stage-down"
          >
            Move later
          </Button>
        </Flex>
        <Popconfirm
          title={`Remove the "${stage.label}" stage?`}
          description="Its people, notes, transcripts and outcome are deleted with it. This cannot be undone."
          confirmText="Remove stage"
          cancelText="Keep"
          onConfirm={() =>
            void run(() =>
              interviewBriefClient.removeStage(candidacyId, stage.id),
            )
          }
        >
          <Button
            buttonSize="sm"
            variant="ghost"
            disabled={busy}
            data-testid="ib-stage-remove"
          >
            Remove stage
          </Button>
        </Popconfirm>
      </Flex>
    </Flex>
  );
}

const WHEN = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function InterviewBriefForm({ candidacyId }: { candidacyId: string }) {
  const [brief, setBrief] = useState<InterviewBrief | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<string>("technical");

  useEffect(() => {
    let live = true;
    setBrief(null);
    setBusy(true);
    setError(null);
    interviewBriefClient.read(candidacyId).then(
      (loaded) => {
        if (!live) return;
        setBrief(loaded);
        setBusy(false);
      },
      () => {
        if (!live) return;
        setError("The interview's stages could not be read. Try again.");
        setBusy(false);
      },
    );
    return () => {
      live = false;
    };
  }, [candidacyId]);

  // One write at a time: the form shows what the server answers with, and a
  // refusal says why in the person's words.
  const run: Run = useCallback(async (work) => {
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      if (next) setBrief(next);
    } catch (failure) {
      setError(refusalOf(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!brief)
    return (
      <Flex vertical gap={8} data-testid="ib-form" aria-busy={busy}>
        {error ? (
          <Alert variant="error" title={error} />
        ) : (
          <Alert variant="loading" title="Reading the interview's stages…" />
        )}
      </Flex>
    );

  const move = (stage: InterviewStage, by: -1 | 1) => {
    const order = brief.stages.map((each) => each.id);
    const at = order.indexOf(stage.id);
    const to = at + by;
    if (to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to] as string, order[at] as string];
    void run(() => interviewBriefClient.orderStages(candidacyId, order));
  };
  return (
    <Flex vertical gap={16} data-testid="ib-form" aria-busy={busy}>
      {error && (
        <Flex vertical data-testid="ib-error">
          <Alert variant="error" title={error} />
        </Flex>
      )}
      <Card data-testid="ib-stages">
        <CardHeader>
          <CardTitle>Stages</CardTitle>
          <Typography.Text type="secondary">
            Each round of this application: who you meet, what you prepared,
            what was said, and how it went.
          </Typography.Text>
        </CardHeader>
        <CardContent>
          <Flex vertical gap={12}>
            {brief.stages.length === 0 ? (
              <Typography.Text type="secondary">No stages yet</Typography.Text>
            ) : (
              <Collapse
                size="small"
                defaultActiveKey={brief.stages[0]?.id ?? ""}
                items={brief.stages.map((stage) => ({
                  key: stage.id,
                  label: `${stage.ordinal}. ${stage.label}`,
                  description: [
                    words(stage.kind),
                    stage.scheduledAt
                      ? WHEN.format(new Date(stage.scheduledAt))
                      : "",
                    words(stage.status),
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  children: (
                    <StageSection
                      candidacyId={candidacyId}
                      stage={stage}
                      count={brief.stages.length}
                      busy={busy}
                      run={run}
                      move={(by) => move(stage, by)}
                    />
                  ),
                }))}
              />
            )}
            <Flex gap={8} align="end" wrap="wrap">
              <Input
                label="Another stage"
                placeholder="e.g. Technical"
                value={label}
                onChange={setLabel}
                disabled={busy}
                data-testid="ib-stage-new-label"
              />
              <Select
                label="Kind"
                value={kind}
                options={options(INTERVIEW_STAGE_KINDS)}
                onChange={setKind}
                disabled={busy}
                data-testid="ib-stage-new-kind"
              />
              <Button
                buttonSize="sm"
                variant="outline"
                disabled={
                  busy ||
                  label.trim() === "" ||
                  brief.stages.length >= INTERVIEW_BRIEF_BOUNDS.stages
                }
                onClick={() =>
                  void run(async () => {
                    const next = await interviewBriefClient.addStage(
                      candidacyId,
                      { kind, label: label.trim() },
                    );
                    setLabel("");
                    return next;
                  })
                }
                data-testid="ib-stage-add"
              >
                Add stage
              </Button>
            </Flex>
          </Flex>
        </CardContent>
      </Card>

      <EmployerSaidList
        entries={brief.employerSaid.map((entry) => ({
          id: entry.id,
          said: entry.said,
          ...(entry.saidBy ? { saidBy: entry.saidBy } : {}),
          ...(entry.channel ? { channel: entry.channel } : {}),
          ...(entry.saidOn ? { saidOn: entry.saidOn } : {}),
        }))}
        disabled={busy}
        onAdd={(entry) =>
          void run(() =>
            interviewBriefClient.addEmployerSaid(candidacyId, entry),
          )
        }
        onRemove={(id) =>
          void run(() =>
            interviewBriefClient.removeEmployerSaid(candidacyId, id),
          )
        }
      />
      <ResearchList
        documents={brief.research.map((document) => ({
          id: document.id,
          title: document.title,
          from: document.originRef ?? words(document.origin),
          chars: document.chars,
          carried: document.carried,
        }))}
        disabled={busy}
        onAdd={(document) =>
          void run(() =>
            interviewBriefClient.addResearch(candidacyId, document),
          )
        }
        onUpload={(file) =>
          void run(() => interviewBriefClient.uploadResearch(candidacyId, file))
        }
        onKeep={() =>
          void run(() => interviewBriefClient.keepCarriedResearch(candidacyId))
        }
        onRemove={(id) =>
          void run(() => interviewBriefClient.removeResearch(candidacyId, id))
        }
      />
      <PackReviewSection candidacyId={candidacyId} disabled={busy} />
    </Flex>
  );
}
