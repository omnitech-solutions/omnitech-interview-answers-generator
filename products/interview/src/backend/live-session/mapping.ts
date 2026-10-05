// Mapping between the database's underscore values and the neutral core's forms
// (device_only <-> device-only, delete_at_end <-> delete-at-end). Only this
// layer knows both; the core imports neither the database nor this file.
import type { ProcessingPolicy } from "./core/index";
import { SessionError } from "./errors";

export type RetentionMode = "delete-at-end" | "thirty-days" | "until-deleted";

const POLICY_TO_DB: Record<ProcessingPolicy, string> = {
  "device-only": "device_only",
  "permitted-remote": "permitted_remote",
};
const POLICY_FROM_DB: Record<string, ProcessingPolicy> = {
  device_only: "device-only",
  permitted_remote: "permitted-remote",
};
const RETENTION_TO_DB: Record<RetentionMode, string> = {
  "delete-at-end": "delete_at_end",
  "thirty-days": "thirty_days",
  "until-deleted": "until_deleted",
};
const RETENTION_FROM_DB: Record<string, RetentionMode> = {
  delete_at_end: "delete-at-end",
  thirty_days: "thirty-days",
  until_deleted: "until-deleted",
};
// Shorter is a lower rank; the database refuses a higher one (monotonic).
const RETENTION_RANK: Record<RetentionMode, number> = {
  "delete-at-end": 0,
  "thirty-days": 1,
  "until-deleted": 2,
};

export const policyToDb = (policy: ProcessingPolicy): string =>
  POLICY_TO_DB[policy];
export const retentionToDb = (mode: RetentionMode): string =>
  RETENTION_TO_DB[mode];
export const retentionRank = (mode: RetentionMode): number =>
  RETENTION_RANK[mode];

export function policyFromDb(value: unknown): ProcessingPolicy {
  const policy = POLICY_FROM_DB[String(value)];
  if (!policy) throw new SessionError("invalid_input");
  return policy;
}

export function retentionFromDb(value: unknown): RetentionMode {
  const mode = RETENTION_FROM_DB[String(value)];
  if (!mode) throw new SessionError("invalid_input");
  return mode;
}

export const isRetentionMode = (value: unknown): value is RetentionMode =>
  typeof value === "string" && value in RETENTION_RANK;
export const isProcessingPolicy = (value: unknown): value is ProcessingPolicy =>
  typeof value === "string" && value in POLICY_TO_DB;

// The workspace draft is a text key in the assistant draft table (workspace id
// and artifact id), so the session stores one unambiguous encoding of both.
export type WorkspaceDraftKey = { workspaceId: string; artifactId: string };
export const encodeDraftKey = (key: WorkspaceDraftKey): string =>
  JSON.stringify([key.workspaceId, key.artifactId]);
export function decodeDraftKey(value: string | null): WorkspaceDraftKey | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (
    Array.isArray(parsed) &&
    typeof parsed[0] === "string" &&
    typeof parsed[1] === "string"
  )
    return { workspaceId: parsed[0], artifactId: parsed[1] };
  return null;
}
