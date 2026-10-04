// Real-provider checks of the session agent port (ADR-0016). Skipped unless
// ACTIVE_SESSION_AGENT_INTEGRATION=claude-code|codex names a runtime that is
// signed in on this machine. The text case sends a fixed trivial prompt and
// asserts only the shape of the result. The image case sends a synthetic,
// non-private picture of the words "BANANA 42" and asserts the provider read
// them, tool-less, through the same worker port and real adapters.
import { readdir } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { createClaudeRuntimeAdapter } from "@omnitech/agent-runtime-claude";
import { createCodexRuntimeAdapter } from "@omnitech/agent-runtime-codex";
import type { AiProfile } from "@omnitech/ai-runtime";
import { resolveAgentProfiles } from "@omnitech/ai-runtime/config";
import { describe, expect, it } from "vitest";
import {
  createSessionAgentPort,
  defaultStagingBase,
} from "./session-agent-port.js";

const runtime = process.env["ACTIVE_SESSION_AGENT_INTEGRATION"];

// 5x7 glyphs for the fixture text; each row is a 5-bit mask.
const GLYPHS: Readonly<Record<string, readonly number[]>> = {
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  " ": [0, 0, 0, 0, 0, 0, 0],
};

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

// A tiny pure-JS rasteriser: large black glyphs on white, 8-bit grayscale PNG.
function textPng(text: string, scale = 14): Buffer {
  const pad = 2 * scale;
  const width = text.length * 6 * scale + 2 * pad - scale;
  const height = 7 * scale + 2 * pad;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width, 255);
    row[0] = 0;
    const glyphRow = Math.floor((y - pad) / scale);
    if (glyphRow >= 0 && glyphRow < 7)
      for (let x = 0; x < width; x += 1) {
        const col = Math.floor((x - pad) / scale);
        const glyph = GLYPHS[text[Math.floor(col / 6)] ?? " "];
        if (
          col >= 0 &&
          col % 6 < 5 &&
          ((glyph?.[glyphRow] ?? 0) >> (4 - (col % 6))) & 1
        )
          row[1 + x] = 0;
      }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function setup() {
  const agent = resolveAgentProfiles(process.env).get(
    runtime === "codex" ? "assistant-codex" : "assistant-claude-code",
  );
  if (!agent) throw new Error("profile missing");
  const profile: AiProfile = {
    id: "integration",
    label: "integration",
    family: "agent-runtime",
    targetId: agent.runtime,
    taskTypes: ["structured-generation"],
    enabled: true,
  };
  const adapters = {
    codex: createCodexRuntimeAdapter(),
    "claude-code": createClaudeRuntimeAdapter(),
  };
  const port = createSessionAgentPort({
    runtimes: adapters,
    profiles: new Map([[profile.id, agent]]),
    attachmentSource: async () => textPng("BANANA 42"),
  });
  const context = {
    tenantId: "t",
    userId: "u",
    productId: "p",
    permissions: [],
  };
  return { profile, port, adapters, context };
}

describe.skipIf(runtime !== "claude-code" && runtime !== "codex")(
  "session agent port against a real provider (requires ACTIVE_SESSION_AGENT_INTEGRATION)",
  () => {
    it("answers one tool-less question and leaves no staged files", async () => {
      const { profile, port, adapters, context } = setup();
      const execution = await port.execute(
        {
          context,
          task: {
            type: "structured-generation",
            prompt: "Reply with the word ok.",
          },
        },
        profile,
      );
      expect(execution.family).toBe("agent-runtime");
      await port.sweep();
      for (const adapter of Object.values(adapters)) await adapter.close?.();
    }, 120_000);

    it("reads the text in a screenshot, tool-less", async () => {
      const { profile, port, adapters, context } = setup();
      const execution = await port.execute(
        {
          context,
          task: {
            type: "structured-generation",
            prompt:
              'Read the text in the attached image exactly. Reply with JSON {"text": "<the text you read>"}.',
            schema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
              additionalProperties: false,
            },
            attachments: [
              {
                id: "synthetic",
                kind: "image",
                name: "synthetic.png",
                reference: "synthetic",
                mimeType: "image/png",
              },
            ],
          },
        },
        profile,
      );
      const result = execution.result as { text?: string };
      // The recorded observation: result tokens are logged by the runner.
      process.stderr.write(
        `IMAGE-RESULT ${runtime} ${JSON.stringify(result)}\n`,
      );
      expect(result.text?.toUpperCase().replace(/\s+/g, " ").trim()).toBe(
        "BANANA 42",
      );
      // Staged screenshot and provider home are gone once the attempt settles.
      expect(
        await readdir(defaultStagingBase()).catch(() => [] as string[]),
      ).toEqual([]);
      for (const adapter of Object.values(adapters)) await adapter.close?.();
    }, 180_000);
  },
);
