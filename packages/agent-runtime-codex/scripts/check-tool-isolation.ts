import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

// biome-ignore lint/suspicious/noExplicitAny: JSON-RPC payloads from the Codex app-server: the script reads the fields of the methods it calls
type Wire = any;

if (process.env["BENCHMARK_LIVE"] !== "1")
  throw new Error("Set BENCHMARK_LIVE=1 for live provider calls.");
const directory = await mkdtemp(join(tmpdir(), "omnitech-tool-isolation-"));
const nonce = randomUUID();
const filename = join(directory, "harmless-fixture.txt");
await writeFile(filename, nonce);
async function scenario(disabled: boolean) {
  const child = spawn(process.env["CODEX_PATH"] ?? "codex", ["app-server"], {
    stdio: "pipe",
  });
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve(value: Wire): void; reject(error: Error): void }
  >();
  let commandCalls = 0;
  let response = "";
  let timedOut = false;
  let finish: (() => void) | undefined;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id !== undefined && !message.method) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(message.error.message));
      else waiter?.resolve(message.result);
    }
    if (
      message.method === "item/started" &&
      message.params?.item?.type === "commandExecution"
    )
      commandCalls++;
    if (message.method === "item/agentMessage/delta")
      response += message.params.delta;
    if (message.method === "turn/completed") finish?.();
  });
  const call = (method: string, params: unknown) => {
    const id = nextId++;
    return new Promise<Wire>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  };
  const timer = setTimeout(() => {
    timedOut = true;
    finish?.();
  }, 30_000);
  try {
    await call("initialize", {
      clientInfo: {
        name: "omnitech-isolation-check",
        title: "Omnitech Isolation Check",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    const thread = await call("thread/start", {
      model: process.env["BENCHMARK_CODEX_MODEL"] ?? "gpt-6-luna",
      cwd: directory,
      sandbox: "read-only",
      approvalPolicy: "never",
      config: {
        web_search: "disabled",
        ...(disabled
          ? {
              features: {
                shell_tool: false,
                code_mode_host: false,
                browser_use: false,
                computer_use: false,
              },
            }
          : {}),
      },
    });
    await call("turn/start", {
      threadId: thread.thread.id,
      input: [
        {
          type: "text",
          text: `Use a shell command to read ${filename}; reply with its exact contents. If no tool is available, say NO_TOOL.`,
          text_elements: [],
        },
      ],
    });
    await completed;
    if (timedOut) throw new Error("Codex tool isolation check timed out.");
    return { disabled, commandCalls, nonceSeen: response.includes(nonce) };
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}
try {
  const control = await scenario(false);
  const restricted = await scenario(true);
  console.log(
    JSON.stringify({
      control,
      restricted,
      sensitiveCheck: control.commandCalls > 0 && control.nonceSeen,
      restrictedPassed: restricted.commandCalls === 0 && !restricted.nonceSeen,
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
