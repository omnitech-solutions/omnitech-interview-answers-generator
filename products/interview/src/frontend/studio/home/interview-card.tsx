import type { InterviewPlan, PlanItem } from "@omnitech/interview-contracts";
import { type FormEvent, useState } from "react";
import { Button } from "../../ui";
import { Icon } from "../icon";
import type { PlanState } from "./use-plan";

const when = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

// "2026-10-08T16:00:00Z" → the local value a datetime-local input expects.
function localInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function daysUntil(iso: string | null, now = Date.now()) {
  if (!iso) return null;
  const day = 86_400_000;
  const start = (time: number) => {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  return Math.round((start(new Date(iso).getTime()) - start(now)) / day);
}

export function InterviewCard({
  plan,
  items,
  state,
}: {
  plan: InterviewPlan | null;
  items: readonly PlanItem[];
  state: PlanState;
}) {
  const [editing, setEditing] = useState(false);
  if (editing || !plan)
    return (
      <InterviewForm
        plan={plan}
        onCancel={plan ? () => setEditing(false) : undefined}
        onSave={async (input) => {
          await state.saveInterview(input);
          setEditing(false);
        }}
      />
    );
  const done = items.filter((item) => item.done).length;
  const meta = [
    plan.scheduledAt ? when.format(new Date(plan.scheduledAt)) : null,
    plan.durationMinutes ? `${plan.durationMinutes} min` : null,
    plan.format || null,
  ].filter(Boolean);
  return (
    <section
      className="home-card home-interview"
      aria-label="Upcoming interview"
    >
      <div className="home-card-head">
        <Icon name="event" />
        <span>Upcoming interview</span>
        <span className="ws-spacer" />
        <button
          type="button"
          className="home-link"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      </div>
      <div>
        <div className="home-interview-title">
          {plan.company} · {plan.role}
        </div>
        {meta.length > 0 && (
          <div className="home-muted">{meta.join(" · ")}</div>
        )}
      </div>
      {plan.topics.length > 0 && (
        <div className="home-chips">
          {plan.topics.map((topic) => (
            <span key={topic} className="home-chip">
              {topic}
            </span>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="home-progress">
          <div className="home-progress-label">
            <span className="home-muted">Prep plan</span>
            <span className="ws-mono">
              {done} / {items.length}
            </span>
          </div>
          <div
            className="home-bar"
            role="progressbar"
            aria-label="Prep plan done"
            aria-valuenow={done}
            aria-valuemax={items.length}
          >
            <div style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}

function InterviewForm({
  plan,
  onSave,
  onCancel,
}: {
  plan: InterviewPlan | null;
  onSave(input: Parameters<PlanState["saveInterview"]>[0]): Promise<void>;
  onCancel: (() => void) | undefined;
}) {
  const [company, setCompany] = useState(plan?.company ?? "");
  const [role, setRole] = useState(plan?.role ?? "");
  const [scheduled, setScheduled] = useState(
    localInput(plan?.scheduledAt ?? null),
  );
  const [duration, setDuration] = useState(
    plan?.durationMinutes ? String(plan.durationMinutes) : "60",
  );
  const [format, setFormat] = useState(plan?.format ?? "");
  const [topics, setTopics] = useState(plan?.topics.join(", ") ?? "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave({
      id: plan?.id ?? null,
      company: company.trim(),
      role: role.trim(),
      scheduledAt: scheduled ? new Date(scheduled).toISOString() : null,
      durationMinutes: duration ? Number(duration) : null,
      format: format.trim(),
      topics: topics
        .split(",")
        .map((topic) => topic.trim())
        .filter(Boolean)
        .slice(0, 12),
    });
  };
  return (
    <form
      className="home-card home-interview"
      aria-label="Interview details"
      onSubmit={submit}
    >
      <div className="home-card-head">
        <Icon name="event" />
        <span>{plan ? "Edit interview" : "Add your next interview"}</span>
      </div>
      <div className="home-form">
        <label>
          Company
          <input
            required
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />
        </label>
        <label>
          Role
          <input
            required
            value={role}
            onChange={(event) => setRole(event.target.value)}
          />
        </label>
        <label>
          When
          <input
            type="datetime-local"
            value={scheduled}
            onChange={(event) => setScheduled(event.target.value)}
          />
        </label>
        <label>
          Minutes
          <input
            type="number"
            min={5}
            max={600}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
        <label className="home-form-wide">
          Format
          <input
            placeholder="e.g. live coding + concepts"
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          />
        </label>
        <label className="home-form-wide">
          Topics
          <input
            placeholder="TypeScript, PostgreSQL, React"
            value={topics}
            onChange={(event) => setTopics(event.target.value)}
          />
        </label>
      </div>
      <div className="home-form-actions">
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        <Button variant="primary" type="submit">
          {plan ? "Save" : "Add interview"}
        </Button>
      </div>
    </form>
  );
}
