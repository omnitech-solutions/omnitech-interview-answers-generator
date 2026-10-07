import type {
  BriefingClient,
  BriefingProfileSummary,
} from "@omnitech/interview-api-client";
import {
  type CandidateMatrix,
  candidateMatrixSchema,
} from "@omnitech/interview-contracts";
import { useRef, useState } from "react";
import { formatRelativeTime } from "../../../format-timestamp";
import { Button } from "../../../ui";
import { Icon } from "../../icon";
import { Dialog } from "../../shared/dialog";
import { DEFAULT_PROFILE_ID } from "./config";

export type ProfileRef = { id: string; revision: number };

// [DOMAIN] The default matrix is a per-person convenience, so it lives in
// this browser; without one the local experience matrix is the default.
const DEFAULT_KEY = "omnitech.interview.default-matrix";
export function readDefaultMatrix(): string {
  try {
    return localStorage.getItem(DEFAULT_KEY) ?? DEFAULT_PROFILE_ID;
  } catch {
    return DEFAULT_PROFILE_ID;
  }
}
function writeDefaultMatrix(id: string) {
  try {
    localStorage.setItem(DEFAULT_KEY, id);
  } catch {
    // Private windows keep the built-in default.
  }
}

// Which matrix a new pack answers from: the default, else the newest.
export function defaultProfile(
  profiles: readonly BriefingProfileSummary[],
): ProfileRef | null {
  const preferred = readDefaultMatrix();
  const chosen =
    profiles.find((profile) => profile.id === preferred) ??
    profiles.find((profile) => profile.id === DEFAULT_PROFILE_ID) ??
    profiles[0];
  return chosen ? { id: chosen.id, revision: chosen.revision } : null;
}

export const matrixCounts = (matrix: CandidateMatrix) =>
  `${matrix.roles.length} role${matrix.roles.length === 1 ? "" : "s"} · ${matrix.story_selector?.length ?? 0} stories`;

export function MatrixPicker({
  client,
  profiles,
  value,
  matrix,
  onChange,
  onImported,
}: {
  client: BriefingClient;
  profiles: readonly BriefingProfileSummary[];
  value: ProfileRef | null;
  // The chosen matrix, once loaded, for its role and story counts.
  matrix: CandidateMatrix | null;
  onChange(profile: ProfileRef): void;
  onImported(profile: ProfileRef): void;
}) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [defaultId, setDefaultId] = useState(readDefaultMatrix);
  const chosen = profiles.find((profile) => profile.id === value?.id);
  const meta = (profile: BriefingProfileSummary, counts?: string) =>
    [
      `Revision ${profile.revision}`,
      counts,
      `updated ${formatRelativeTime(profile.updatedAt)}`,
    ]
      .filter(Boolean)
      .join(" · ");
  function makeDefault(id: string) {
    writeDefaultMatrix(id);
    setDefaultId(id);
  }

  return (
    <div className="bp-section bp-matrix">
      <div className="bp-eyebrow">Experience matrix</div>
      <button
        type="button"
        className="bp-matrix-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="bp-tile">
          <Icon name="grid_view" />
        </span>
        <span className="bp-grow">
          <span className="bp-matrix-name">
            {chosen?.name ?? "Import your experience matrix"}
            {chosen?.id === defaultId && (
              <span className="bp-badge">Default</span>
            )}
          </span>
          <span className="bp-meta">
            {chosen
              ? meta(chosen, matrix ? matrixCounts(matrix) : undefined)
              : "Answers are drafted from it, with each claim linked back."}
          </span>
        </span>
        <Icon name="expand_more" />
      </button>
      {open && (
        <div className="bp-menu" role="menu">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              role="menuitemradio"
              aria-checked={profile.id === value?.id}
              onClick={() => {
                onChange({ id: profile.id, revision: profile.revision });
                setOpen(false);
              }}
            >
              <span className="bp-grow">
                <span className="bp-matrix-name">
                  {profile.name}
                  {profile.id === defaultId && (
                    <span className="bp-badge">Default</span>
                  )}
                </span>
                <span className="bp-meta">{meta(profile)}</span>
              </span>
              {profile.id === value?.id && <Icon name="check" />}
            </button>
          ))}
          <div className="bp-menu-rule" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setImporting(true);
            }}
          >
            <Icon name="upload_file" />
            Import from JSON…
          </button>
          {chosen && chosen.id !== defaultId && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                makeDefault(chosen.id);
                setOpen(false);
              }}
            >
              <Icon name="star" />
              Make this my default
            </button>
          )}
        </div>
      )}
      {importing && (
        <ImportMatrixDialog
          client={client}
          onClose={() => setImporting(false)}
          onImported={(profile, asDefault) => {
            if (asDefault) makeDefault(profile.id);
            setImporting(false);
            onImported(profile);
          }}
        />
      )}
    </div>
  );
}

function ImportMatrixDialog({
  client,
  onClose,
  onImported,
}: {
  client: BriefingClient;
  onClose(): void;
  onImported(profile: ProfileRef, asDefault: boolean): void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [source, setSource] = useState("");
  const [asDefault, setAsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  // [GUARD] Parse as the person types or drops: the preview shows what
  // will be imported, and an invalid file never reaches the server.
  const parsed = (() => {
    if (!source.trim()) return null;
    try {
      const result = candidateMatrixSchema.safeParse(JSON.parse(source));
      return result.success
        ? { matrix: result.data }
        : {
            error:
              "That JSON isn’t an experience matrix: it needs a candidate and a roles list.",
          };
    } catch {
      return {
        error: "That isn’t valid JSON. Check for a missing comma or bracket.",
      };
    }
  })();
  const matrix = parsed && "matrix" in parsed ? parsed.matrix : null;
  const undated = matrix?.roles.filter((role) => !role.period).length ?? 0;

  async function read(file: File) {
    setFileName(file.name);
    setSource(await file.text());
  }
  async function save() {
    if (!matrix) return;
    setBusy(true);
    setFailure("");
    try {
      const name =
        fileName.replace(/\.json$/i, "") ||
        (matrix.candidate.name
          ? `${matrix.candidate.name}’s matrix`
          : "Imported matrix");
      const result = await client.importProfile({ name, matrix });
      onImported({ id: result.id, revision: result.revision }, asDefault);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The import failed.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Import an experience matrix"
      onClose={onClose}
      scrimClassName="bp-scrim"
      className="bp-dialog"
    >
      <div className="bp-dialog-head">
        <span className="bp-grow">Import an experience matrix</span>
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="bp-dialog-body">
        <button
          type="button"
          className="bp-drop"
          onClick={() => fileInput.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) void read(file);
          }}
        >
          <Icon name="upload_file" size={26} />
          <span>Drop a matrix .json file, or click to choose</span>
          {fileName && <span className="bp-mono">{fileName}</span>}
        </button>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept="application/json,.json"
          aria-label="Matrix JSON file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void read(file);
          }}
        />
        <div className="bp-or">or paste JSON</div>
        <textarea
          className="bp-mono"
          rows={4}
          aria-label="Matrix JSON"
          placeholder='{ "candidate": { … }, "roles": [ … ] }'
          value={source}
          onChange={(event) => {
            setFileName("");
            setSource(event.target.value);
          }}
        />
        {parsed && "error" in parsed && (
          <p className="bp-error" role="alert">
            <Icon name="error" />
            {parsed.error}
          </p>
        )}
        {matrix && (
          <div className="bp-preview">
            <strong>Preview</strong>
            <div className="bp-stats">
              <div>
                <span>Roles</span>
                <b>{matrix.roles.length}</b>
              </div>
              <div>
                <span>Stories</span>
                <b>{matrix.story_selector?.length ?? 0}</b>
              </div>
              <div>
                <span>Repositories</span>
                <b>{matrix.repositories_of_note?.length ?? 0}</b>
              </div>
            </div>
            {undated > 0 && (
              <p className="bp-note">
                <Icon name="warning" />
                {undated} role{undated === 1 ? " has" : "s have"} no dates.
                They’ll still be used.
              </p>
            )}
            <label className="bp-check">
              <input
                type="checkbox"
                checked={asDefault}
                onChange={(event) => setAsDefault(event.target.checked)}
              />
              Make this my default matrix
            </label>
          </div>
        )}
        {failure && (
          <p className="bp-error" role="alert">
            <Icon name="error" />
            {failure}
          </p>
        )}
      </div>
      <div className="bp-dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!matrix || busy}
          onClick={() => void save()}
        >
          {busy ? "Importing…" : "Import matrix"}
        </Button>
      </div>
    </Dialog>
  );
}
