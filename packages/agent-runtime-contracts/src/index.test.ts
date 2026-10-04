import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AGENT_IMAGE_MAX_BYTES,
  AgentAttachmentRefusedError,
  type AgentProfile,
  stagedImages,
  validateAgentProfile,
} from "./index.js";

const safeProfile: AgentProfile = {
  id: "document-quality",
  version: 1,
  runtime: "claude-code",
  model: "configured-model",
  fallbackModels: [],
  effort: "high",
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  sessionPersistence: false,
  maximumTurns: 2,
  timeoutMs: 60_000,
  maximumOutputBytes: 1_000_000,
  additionalDirectories: [],
  webSearch: false,
};

describe("agent profiles", () => {
  it("accepts a bounded read-only profile", () => {
    expect(() => validateAgentProfile(safeProfile)).not.toThrow();
  });

  it("rejects unapproved additional directories", () => {
    expect(() =>
      validateAgentProfile({
        ...safeProfile,
        additionalDirectories: ["/"],
      }),
    ).toThrow("Additional directories");
  });

  it("rejects a profile without a positive integer version", () => {
    expect(() => validateAgentProfile({ ...safeProfile, version: 0 })).toThrow(
      "version",
    );
  });

  it("rejects unattended write access", () => {
    expect(() =>
      validateAgentProfile({
        ...safeProfile,
        sandbox: "workspace-write",
      }),
    ).toThrow("cannot combine");
  });
});

describe("staged image attachments", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "contracts-stage-"));
    await mkdir(join(root, "stage"));
    await writeFile(join(root, "stage", "ok.png"), "x");
    await writeFile(
      join(root, "stage", "big.png"),
      Buffer.alloc(AGENT_IMAGE_MAX_BYTES + 1),
    );
    await writeFile(join(root, "outside.png"), "x");
    await symlink(join(root, "outside.png"), join(root, "stage", "link.png"));
  });
  afterAll(async () => rm(root, { recursive: true, force: true }));

  const attachment = (reference: string, overrides = {}) => ({
    id: "a",
    kind: "image" as const,
    name: "n",
    reference,
    mimeType: "image/png",
    ...overrides,
  });
  const attachmentRoot = () => join(root, "stage");

  it("resolves images inside the staging root and nothing else", async () => {
    expect(await stagedImages({ attachments: [] })).toEqual([]);
    const [ok] = await stagedImages({
      attachments: [attachment(join(root, "stage", "ok.png"))],
      attachmentRoot: attachmentRoot(),
    });
    expect(ok?.mimeType).toBe("image/png");
    for (const bad of [
      attachment(join(root, "stage", "big.png")),
      attachment(join(root, "outside.png")),
      attachment(join(root, "stage", "link.png")),
      attachment(join(root, "stage", "missing.png")),
      attachment("stage/ok.png"),
      attachment(attachmentRoot()),
      attachment(join(root, "stage", "ok.png"), { kind: "file" }),
      attachment(join(root, "stage", "ok.png"), { mimeType: "image/svg+xml" }),
      attachment(join(root, "stage", "ok.png"), { mimeType: undefined }),
    ])
      await expect(
        stagedImages({ attachments: [bad], attachmentRoot: attachmentRoot() }),
      ).rejects.toBeInstanceOf(AgentAttachmentRefusedError);
    await expect(
      stagedImages({
        attachments: [attachment(join(root, "stage", "ok.png"))],
      }),
    ).rejects.toBeInstanceOf(AgentAttachmentRefusedError);
    await expect(
      stagedImages({
        attachments: [attachment(join(root, "stage", "ok.png"))],
        attachmentRoot: join(root, "absent"),
      }),
    ).rejects.toBeInstanceOf(AgentAttachmentRefusedError);
  });
});
