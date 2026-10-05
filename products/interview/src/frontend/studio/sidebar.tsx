import type { ProductLink } from "@omnitech/platform-contracts";
import { views } from "./config/views";
import type { StudioTheme } from "./context";
import { Icon } from "./icon";
import { useSessionOpen } from "./live/use-session-open";
import { runStatus } from "./run-status";
import { formatShortcut } from "./use-shortcuts";
import type { StudioLists } from "./use-studio-lists";
import type { ViewId } from "./use-studio-route";

const RECENT_LIMIT = 6;

export function Sidebar({
  view,
  artifact,
  lists,
  theme,
  onGo,
  onOpenArtifact,
  onOpenPalette,
  onToggleTheme,
  products = [],
  mayLeave,
  expanded,
  onToggleExpanded,
}: {
  view: ViewId;
  artifact: string;
  lists: StudioLists;
  theme: StudioTheme;
  onGo(view: ViewId): void;
  onOpenArtifact(artifactId: string): void;
  onOpenPalette(): void;
  onToggleTheme(): void;
  // The other products the member can switch to; leaving the studio first
  // asks `mayLeave`, which protects unsaved preparation.
  products?: readonly ProductLink[];
  mayLeave?: () => boolean;
  // Views that can fold the sidebar to a rail (the Workspace) pass these.
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const indicators = { "session-open": useSessionOpen() };
  return (
    <aside className="studio-sidebar" aria-label="Studio">
      <div className="studio-brand">
        <span className="studio-brand-mark">
          <Icon name="forum" />
        </span>
        <div>
          <div className="studio-brand-name">Interview Studio</div>
          <div className="studio-brand-sub">Omnitech · Local</div>
        </div>
      </div>
      {onToggleExpanded && (
        <button
          type="button"
          className="studio-collapse"
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          onClick={onToggleExpanded}
        >
          <Icon name={expanded ? "chevron_left" : "chevron_right"} />
        </button>
      )}

      <button type="button" className="studio-jump" onClick={onOpenPalette}>
        <Icon name="search" />
        <span>Search or jump to…</span>
        <kbd>{formatShortcut("mod+k")}</kbd>
      </button>

      <nav className="studio-nav" aria-label="Views">
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            className="studio-nav-item"
            aria-current={item.id === view ? "page" : undefined}
            title={item.label}
            onClick={() => onGo(item.id)}
          >
            <Icon name={item.icon} filled={item.id === view} />
            <span className="studio-nav-label">{item.label}</span>
            {item.indicator && indicators[item.indicator] && (
              <span
                className="studio-nav-live"
                role="img"
                aria-label="Session in progress"
              />
            )}
            <kbd>G {item.goKey}</kbd>
          </button>
        ))}
      </nav>

      {products.some((product) => !product.current) && (
        <nav className="studio-nav" aria-label="Products">
          <div className="studio-section-label">Products</div>
          {products
            .filter((product) => !product.current)
            .map((product) => (
              <a
                key={product.productId}
                className="studio-nav-item"
                href={product.href}
                title={product.name}
                onClick={(event) => {
                  if (mayLeave && !mayLeave()) event.preventDefault();
                }}
              >
                <Icon name="grid_view" />
                <span className="studio-nav-label">{product.name}</span>
              </a>
            ))}
        </nav>
      )}

      <div className="studio-section-label">Recent questions</div>
      <div className="studio-recent">
        {lists.status === "error" ? (
          <div className="studio-recent-note" role="alert">
            Couldn’t load questions.
            <button type="button" onClick={lists.refresh}>
              Retry
            </button>
          </div>
        ) : lists.status === "ready" && !lists.questions.length ? (
          <div className="studio-recent-note">
            Your questions will appear here.
          </div>
        ) : (
          lists.questions.slice(0, RECENT_LIMIT).map((question) => (
            <button
              key={question.artifactId}
              type="button"
              className="studio-recent-item"
              aria-current={
                view === "work" && question.artifactId === artifact
                  ? "page"
                  : undefined
              }
              title={question.title}
              onClick={() => onOpenArtifact(question.artifactId)}
            >
              <span
                className={`studio-dot ${runStatus(question).tone}`}
                aria-hidden="true"
              />
              <span className="studio-recent-title">{question.title}</span>
            </button>
          ))
        )}
      </div>

      <div className="studio-identity">
        <span className="studio-avatar" aria-hidden="true">
          LU
        </span>
        <div className="studio-identity-text">
          <div>Local user</div>
          <div className="studio-identity-sub">
            <span className="studio-online" aria-hidden="true" />
            local · {artifact}
          </div>
        </div>
        <button
          type="button"
          className="studio-icon-button"
          aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
          title="Toggle theme"
          onClick={onToggleTheme}
        >
          <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} />
        </button>
      </div>
    </aside>
  );
}
