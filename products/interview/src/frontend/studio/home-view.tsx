import { formatRelativeTime, formatTimestamp } from "../format-timestamp";
import type { StudioActions } from "./config/commands";
import { Icon } from "./icon";
import type { StudioLists } from "./use-studio-lists";

const CONTINUE_LIMIT = 8;
const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  react: "React",
  php: "PHP",
  ruby: "Ruby",
};

function greeting(hour: number) {
  return hour < 12
    ? "Good morning"
    : hour < 18
      ? "Good afternoon"
      : "Good evening";
}

// Interim Home: what you were working on. The interview card and prep plan
// arrive with their data (redesign step 3).
export function HomeView({
  actions,
  lists,
}: {
  actions: StudioActions;
  lists: StudioLists;
}) {
  return (
    <div className="studio-page">
      <div className="studio-page-inner">
        <div className="studio-page-head">
          <div>
            <h1>{greeting(new Date().getHours())}</h1>
            <p>Pick up where you left off, or start something new.</p>
          </div>
          <button
            type="button"
            className="studio-button"
            onClick={actions.newQuestion}
          >
            <Icon name="add" />
            New question
          </button>
          <button
            type="button"
            className="studio-button primary"
            onClick={() => actions.go("rehearsal")}
          >
            <Icon name="play_arrow" filled />
            Start a rehearsal
          </button>
        </div>

        <section className="studio-section" aria-labelledby="home-continue">
          <h2 id="home-continue">Continue</h2>
          <div className="studio-list">
            {lists.questions.slice(0, CONTINUE_LIMIT).map((question) => (
              <button
                key={question.artifactId}
                type="button"
                className="studio-list-row"
                onClick={() => actions.openArtifact(question.artifactId)}
              >
                <span className="studio-list-title">{question.title}</span>
                <span className="studio-mono">
                  {question.language
                    ? (LANGUAGE_LABELS[question.language] ?? question.language)
                    : "—"}
                </span>
                <span
                  className="studio-faint"
                  title={formatTimestamp(question.updatedAt)}
                >
                  {formatRelativeTime(question.updatedAt)}
                </span>
              </button>
            ))}
            {lists.status === "ready" && !lists.questions.length && (
              <div className="studio-list-empty">
                No questions yet. Start with “New question”.
              </div>
            )}
            {lists.status === "error" && (
              <div className="studio-list-empty" role="alert">
                Couldn’t load your questions.{" "}
                <button type="button" onClick={lists.refresh}>
                  Retry
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
