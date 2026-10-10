// The Interview form's "Context pack" card: the review of what a model read
// for one application (ADR-0041), for the person to check before the coach, a
// briefing or a document leans on it.
//
// It reads the review, prepares the pack (showing how far it is, and letting
// the person stop it), and takes the person's corrections: confirm, edit or
// remove a fact. Every answer of the server replaces what is shown. Nothing a
// source or a record says is logged. Library parts only: no markup or style
// of this product's own.
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapse,
  Flex,
  Popconfirm,
  Progress,
  Tag,
  Textarea,
  Typography,
} from "@oc-tech/omni-ui-components";
import {
  PACK_REVIEW_BOUNDS,
  type PackCorrection,
  type PackPrepareInput,
  type PackReview,
  type PackReviewRecord,
  type PackSourceState,
} from "@omnitech/interview-contracts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { DocumentsApiError } from "../documents/documents-client";
import {
  type PackPrepareProgress,
  packReviewClient,
} from "./pack-review-client";

// A kind of record, as a person would name it. An unknown kind shows as itself.
const KIND_LABEL: Record<string, string> = {
  "employer-requirement": "Requirements",
  "employer-fact": "Employer facts",
  "prep-note": "Prep notes",
  "candidate-achievement": "Achievements",
  "candidate-role": "Roles",
  "candidate-story": "Stories",
  "candidate-preference": "Preferences",
  "candidate-profile": "Profile",
  "employer-detail": "Employer",
  "stage-question": "Questions asked",
  "stage-answer": "Answers given",
  "employer-signal": "Signals",
  "stage-commitment": "Commitments",
  "transcript-turn": "Transcript turns",
};
const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

const STATE_LABEL: Record<PackSourceState, string> = {
  current: "Read",
  changed: "Changed since it was read",
  unread: "Not read yet",
  withheld: "Kept on this device",
  partial: "Partly read",
  structured: "Your own material",
};

// What each refusal means to the person, in their words.
const REFUSAL: Record<string, string> = {
  "generation-unavailable":
    "No model is available to prepare the pack right now.",
  "already-running": "This pack is already being prepared.",
  "generation-failed":
    "The model could not prepare the pack. Nothing was lost; try again.",
};
const refusalOf = (error: unknown) =>
  (error instanceof DocumentsApiError && REFUSAL[error.code]) ||
  "That did not go through. Nothing changed; try again.";
const cancelled = (error: unknown) =>
  error instanceof DocumentsApiError && error.code === "cancelled";

const many = (count: number, one: string, more = `${one}s`) =>
  `${count} ${count === 1 ? one : more}`;
const NOT_STARTED: PackPrepareProgress = {
  t: "progress",
  done: 0,
  total: 0,
  reading: [],
  calls: 0,
};

// One labelled group of the card. The library's Text has no `strong` (and
// its Title no level), so a label is plain Text, as the form's own are.
function Group({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Flex vertical gap={4} data-testid={testId}>
      <Typography.Text>{label}</Typography.Text>
      {children}
    </Flex>
  );
}

// One row: what it is, then what can be done with it.
function Row({
  children,
  actions,
  testId,
}: {
  children: ReactNode;
  actions?: ReactNode;
  testId: string;
}) {
  return (
    <Flex gap={8} align="start" justify="space-between" data-testid={testId}>
      <Flex vertical gap={4}>
        {children}
      </Flex>
      {actions && (
        <Flex gap={4} align="center">
          {actions}
        </Flex>
      )}
    </Flex>
  );
}

// [DOMAIN] How far a preparation is: the sources read of those to read, the
// ones being read now, and what it has asked of the model so far.
function Preparing({
  progress,
  onCancel,
}: {
  progress: PackPrepareProgress;
  onCancel(): void;
}) {
  // Before the first line nothing is known of the total: the bar sits at 0.
  const percent =
    progress.total === 0
      ? 0
      : Math.min(100, Math.round((progress.done / progress.total) * 100));
  return (
    <Flex vertical gap={4} data-testid="pk-progress">
      <Progress percent={percent} />
      {progress.reading.length > 0 && (
        <Typography.Text>
          Reading: {progress.reading.join(", ")}
        </Typography.Text>
      )}
      <Typography.Text type="secondary">
        {many(progress.calls, "model call")} so far
      </Typography.Text>
      <Flex>
        <Button
          buttonSize="sm"
          variant="outline"
          onClick={onCancel}
          data-testid="pk-cancel"
        >
          Cancel
        </Button>
      </Flex>
    </Flex>
  );
}

function Counts({ counts }: { counts: PackReview["counts"] }) {
  return (
    <Group label="What is in the pack" testId="pk-counts">
      {counts.map((count) => (
        <Flex
          key={count.kind}
          gap={4}
          align="center"
          wrap="wrap"
          data-testid="pk-count"
        >
          <Typography.Text>{kindLabel(count.kind)}</Typography.Text>
          <Tag>{count.total}</Tag>
          {count.extracted > 0 && <Tag>{count.extracted} read by a model</Tag>}
          {count.confirmed > 0 && <Tag>{count.confirmed} confirmed</Tag>}
          {count.edited > 0 && <Tag>{count.edited} edited</Tag>}
        </Flex>
      ))}
    </Group>
  );
}

// [DOMAIN] The fit: how many of the employer's requirements have something of
// the person's tied to them, and the ones that have nothing (the real gaps).
function Fit({ fit, gaps }: Pick<PackReview, "fit" | "gaps">) {
  return (
    <Group label="Fit" testId="pk-fit">
      <Typography.Text>
        {fit.strong + fit.partial} of {many(fit.requirements, "requirement")}{" "}
        {fit.requirements === 1 ? "has" : "have"} evidence ({fit.strong} strong,{" "}
        {fit.partial} partial)
      </Typography.Text>
      {fit.refused > 0 && (
        <Typography.Text type="secondary">
          {many(fit.refused, "link")} a model proposed{" "}
          {fit.refused === 1 ? "was" : "were"} refused by the pack's rule.
        </Typography.Text>
      )}
      {gaps.length > 0 && (
        <Flex vertical gap={4} data-testid="pk-gaps">
          <Typography.Text>
            Gaps: asked for, and not in your record
          </Typography.Text>
          {gaps.map((gap) => (
            <Row key={gap.id} testId="pk-gap">
              <Typography.Text>{gap.text}</Typography.Text>
              {gap.note && (
                <Typography.Text type="secondary">{gap.note}</Typography.Text>
              )}
            </Row>
          ))}
        </Flex>
      )}
    </Group>
  );
}

function Stages({ stages }: { stages: PackReview["stages"] }) {
  return (
    <Group label="Stages" testId="pk-stages">
      {stages.map((stage) => (
        <Flex
          key={stage.ordinal}
          gap={4}
          align="center"
          wrap="wrap"
          data-testid="pk-stage"
        >
          <Typography.Text>
            {stage.ordinal}. {stage.label}
          </Typography.Text>
          {stage.empty ? (
            <Tag>No material</Tag>
          ) : (
            <>
              <Tag>{many(stage.notes, "note")}</Tag>
              <Tag>{many(stage.transcripts, "transcript")}</Tag>
              <Tag>{many(stage.extracted, "fact")}</Tag>
            </>
          )}
        </Flex>
      ))}
    </Group>
  );
}

// What can be done with one fact a model read.
type Correct = (correction: PackCorrection) => void;

function RecordRow({
  record,
  off,
  correct,
}: {
  record: PackReviewRecord;
  off: boolean;
  correct: Correct;
}) {
  // The fact as it is being rewritten; null while it is only shown.
  const [draft, setDraft] = useState<string | null>(null);
  // What the server answers with is what the row shows.
  useEffect(() => setDraft(null), [record]);
  return (
    <Row
      testId="pk-record"
      actions={
        <>
          {record.reviewed !== "confirmed" && (
            <Button
              buttonSize="sm"
              variant="ghost"
              disabled={off}
              onClick={() =>
                correct({ recordId: record.id, action: "confirm" })
              }
              data-testid="pk-confirm"
            >
              Confirm
            </Button>
          )}
          <Button
            buttonSize="sm"
            variant="ghost"
            disabled={off || draft !== null}
            onClick={() => setDraft(record.text)}
            data-testid="pk-edit"
          >
            Edit
          </Button>
          <Popconfirm
            title="Remove this fact?"
            description="It is taken out of the pack and stays out when the pack is prepared again."
            confirmText="Remove"
            cancelText="Keep"
            onConfirm={() => correct({ recordId: record.id, action: "remove" })}
          >
            <Button
              buttonSize="sm"
              variant="ghost"
              disabled={off}
              data-testid="pk-remove"
            >
              Remove
            </Button>
          </Popconfirm>
        </>
      }
    >
      {draft === null ? (
        <Typography.Text>{record.text}</Typography.Text>
      ) : (
        <Flex vertical gap={4}>
          <Textarea
            label="The fact, as it should read"
            rows={2}
            maxLength={PACK_REVIEW_BOUNDS.textChars}
            value={draft}
            onChange={setDraft}
            disabled={off}
            data-testid="pk-edit-text"
          />
          <Flex gap={4}>
            <Button
              buttonSize="sm"
              disabled={off || draft.trim() === ""}
              onClick={() =>
                correct({
                  recordId: record.id,
                  action: "edit",
                  text: draft.trim(),
                })
              }
              data-testid="pk-edit-save"
            >
              Save
            </Button>
            <Button
              buttonSize="sm"
              variant="ghost"
              disabled={off}
              onClick={() => setDraft(null)}
              data-testid="pk-edit-cancel"
            >
              Cancel
            </Button>
          </Flex>
        </Flex>
      )}
      {record.quote && (
        <Typography.Text type="secondary">
          Rests on: {record.quote}
        </Typography.Text>
      )}
      <Flex gap={4} wrap="wrap">
        {record.section && <Tag>{record.section}</Tag>}
        {record.level && <Tag>{record.level}</Tag>}
        {record.reviewed === "confirmed" && <Tag>Confirmed</Tag>}
        {record.reviewed === "edited" && <Tag>Edited</Tag>}
      </Flex>
    </Row>
  );
}

// [DOMAIN] The long lists, each closed until it is asked for so the card
// stays short: what was refused, the sources, and what a model read (grouped
// by the source it was read from).
function Lists({
  review,
  off,
  correct,
  again,
}: {
  review: PackReview;
  off: boolean;
  correct: Correct;
  again(sourceId: string): void;
}) {
  const titleOf = (sourceId: string) =>
    review.sources.find((source) => source.id === sourceId)?.title ?? sourceId;
  const bySource = new Map<string, PackReviewRecord[]>();
  for (const record of review.records)
    bySource.set(record.sourceId, [
      ...(bySource.get(record.sourceId) ?? []),
      record,
    ]);
  const items = [
    ...(review.rejected.length > 0
      ? [
          {
            key: "rejected",
            label: "Refused: the source does not say this",
            extra: <Tag>{review.rejected.length}</Tag>,
            children: (
              <Flex vertical gap={8}>
                {review.rejected.map((refused, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a refusal has no identity of its own, and the list is replaced whole
                  <Row key={at} testId="pk-rejected">
                    <Typography.Text>
                      {refused.text ?? "(no text)"}
                    </Typography.Text>
                    <Flex gap={4} wrap="wrap" align="center">
                      {refused.kind && <Tag>{kindLabel(refused.kind)}</Tag>}
                      <Typography.Text type="secondary">
                        {refused.reason}
                      </Typography.Text>
                    </Flex>
                  </Row>
                ))}
              </Flex>
            ),
          },
        ]
      : []),
    {
      key: "sources",
      label: "Sources",
      extra: <Tag>{review.sources.length}</Tag>,
      children: (
        <Flex vertical gap={8}>
          {review.sources.map((source) => (
            <Row
              key={source.id}
              testId="pk-source"
              actions={
                source.readable &&
                review.profile && (
                  <Button
                    buttonSize="sm"
                    variant="ghost"
                    disabled={off}
                    onClick={() => again(source.id)}
                    data-testid="pk-source-again"
                  >
                    Read again
                  </Button>
                )
              }
            >
              <Typography.Text>{source.title}</Typography.Text>
              <Flex gap={4} wrap="wrap">
                <Tag>{STATE_LABEL[source.state]}</Tag>
                {source.extracted > 0 && (
                  <Tag>{many(source.extracted, "fact")}</Tag>
                )}
              </Flex>
            </Row>
          ))}
        </Flex>
      ),
    },
    {
      key: "records",
      label: `What the model read (${review.records.length})`,
      children: (
        <Flex vertical gap={12}>
          {review.records.length === 0 && (
            <Typography.Text type="secondary">
              Nothing read by a model yet
            </Typography.Text>
          )}
          {[...bySource].map(([sourceId, records]) => (
            <Flex key={sourceId} vertical gap={8} data-testid="pk-record-group">
              <Typography.Text>{titleOf(sourceId)}</Typography.Text>
              {records.map((record) => (
                <RecordRow
                  key={record.id}
                  record={record}
                  off={off}
                  correct={correct}
                />
              ))}
            </Flex>
          ))}
        </Flex>
      ),
    },
  ];
  return (
    <>
      {review.withheld.length > 0 && (
        <Group label="Kept on this device" testId="pk-withheld">
          {review.withheld.map((source) => (
            <Row key={source.sourceId} testId="pk-withheld-row">
              <Typography.Text>{source.title}</Typography.Text>
              <Typography.Text type="secondary">
                not sent to a model that does not run on this device
              </Typography.Text>
            </Row>
          ))}
        </Group>
      )}
      {review.holes.length > 0 && (
        <Group label="Parts that could not be read" testId="pk-holes">
          {review.holes.map((hole, at) => (
            <Flex
              // biome-ignore lint/suspicious/noArrayIndexKey: a hole has no identity of its own, and the list is replaced whole
              key={at}
              gap={4}
              align="center"
              wrap="wrap"
              data-testid="pk-hole"
            >
              <Typography.Text>{titleOf(hole.sourceId)}</Typography.Text>
              {hole.locator && <Tag>{hole.locator}</Tag>}
              <Tag>{hole.failure}</Tag>
            </Flex>
          ))}
        </Group>
      )}
      <Collapse size="small" items={items} />
    </>
  );
}

export function PackReviewSection({
  candidacyId,
  disabled = false,
}: {
  candidacyId: string;
  disabled?: boolean;
}) {
  const [review, setReview] = useState<PackReview | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<PackPrepareProgress | null>(null);
  // The preparation in flight, so Cancel (and leaving the form) can stop it.
  const stop = useRef<AbortController | null>(null);
  // Which application's answers may still be shown.
  const shown = useRef(candidacyId);

  useEffect(() => {
    let live = true;
    shown.current = candidacyId;
    setReview(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    packReviewClient.read(candidacyId).then(
      (loaded) => {
        if (!live) return;
        setReview(loaded);
        setBusy(false);
      },
      () => {
        if (!live) return;
        setError("The context pack could not be read. Try again.");
        setBusy(false);
      },
    );
    return () => {
      live = false;
      // [SAFETY] Leaving stops a preparation, exactly as a closed window
      // does: what was read up to then is kept by the server.
      stop.current?.abort();
    };
  }, [candidacyId]);

  // One request at a time: the card shows what the server answers with, and
  // a refusal says why in the person's words.
  const run = async (work: () => Promise<PackReview>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await work();
      if (shown.current === candidacyId) setReview(next);
    } catch (failure) {
      if (shown.current !== candidacyId) return;
      // [DOMAIN] A stopped preparation loses nothing: the pack is read
      // again, so what was read before the stop is on the page.
      if (cancelled(failure)) {
        setNotice("Stopped. What was read so far is kept.");
        await packReviewClient.read(candidacyId).then(
          (kept) => shown.current === candidacyId && setReview(kept),
          () => undefined,
        );
      } else setError(refusalOf(failure));
    } finally {
      if (shown.current === candidacyId) setBusy(false);
    }
  };
  const prepare = (input: PackPrepareInput) => {
    const controller = new AbortController();
    stop.current = controller;
    setProgress(NOT_STARTED);
    void run(() =>
      packReviewClient.prepare(candidacyId, input, {
        signal: controller.signal,
        onProgress: setProgress,
      }),
    ).finally(() => {
      if (stop.current === controller) {
        stop.current = null;
        setProgress(null);
      }
    });
  };
  const correct: Correct = (correction) =>
    void run(() => packReviewClient.correct(candidacyId, [correction]));

  const off = busy || disabled;
  const stats = review?.stats;
  return (
    <Card data-testid="pk-review" aria-busy={busy}>
      <CardHeader>
        <CardTitle>Context pack</CardTitle>
        <Typography.Text type="secondary">
          What a model read from the posting, the research, what the employer
          said and each stage's transcript, each fact with the words it rests
          on. Check it before the coach, a briefing or a document leans on it.
        </Typography.Text>
      </CardHeader>
      <CardContent>
        {/* [GUARD] Nothing read yet: the card says so, or why, and no more. */}
        {!review ? (
          error ? (
            <Flex vertical data-testid="pk-error">
              <Alert variant="error" title={error} />
            </Flex>
          ) : (
            <Alert variant="loading" title="Reading the context pack…" />
          )
        ) : (
          <Flex vertical gap={12}>
            <Flex vertical gap={4} data-testid="pk-state">
              <Typography.Text>
                {!review.prepared
                  ? "Not prepared yet. Until it is, the coach, briefings and documents use your material as it stands."
                  : review.current
                    ? "Prepared."
                    : "Prepared by an earlier version. Prepare again to use it."}
              </Typography.Text>
              {review.profile ? (
                <Typography.Text type="secondary">
                  {review.profile.label}:{" "}
                  {review.profile.onDevice
                    ? "runs on this device"
                    : "runs off this device"}
                </Typography.Text>
              ) : (
                <Alert
                  variant="info"
                  title="No model is set up to prepare the pack. Everything still works from your material as it stands."
                />
              )}
            </Flex>

            {progress ? (
              <Preparing
                progress={progress}
                onCancel={() => stop.current?.abort()}
              />
            ) : (
              <Flex>
                <Button
                  buttonSize="sm"
                  disabled={off || !review.profile}
                  onClick={() => prepare({})}
                  data-testid="pk-prepare"
                >
                  {review.prepared ? "Prepare again" : "Prepare"}
                </Button>
              </Flex>
            )}
            {error && (
              <Flex vertical data-testid="pk-error">
                <Alert variant="error" title={error} />
              </Flex>
            )}
            {notice && (
              <Flex vertical data-testid="pk-notice">
                <Alert variant="info" title={notice} />
              </Flex>
            )}
            {stats && (
              <Flex data-testid="pk-stats">
                <Typography.Text>
                  {`Read ${many(stats.sources, "source")} in ${many(stats.pieces, "piece")}, ${many(stats.calls, "model call")}; kept ${many(stats.kept, "record")}, refused ${stats.rejected}.`}
                </Typography.Text>
              </Flex>
            )}

            {review.counts.length > 0 && <Counts counts={review.counts} />}
            {(review.fit.requirements > 0 ||
              review.fit.refused > 0 ||
              review.gaps.length > 0) && (
              <Fit fit={review.fit} gaps={review.gaps} />
            )}
            {review.stages.length > 0 && <Stages stages={review.stages} />}
            <Lists
              review={review}
              off={off}
              correct={correct}
              again={(sourceId) => prepare({ sourceId })}
            />
          </Flex>
        )}
      </CardContent>
    </Card>
  );
}
