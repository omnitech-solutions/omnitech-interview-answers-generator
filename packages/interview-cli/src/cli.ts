#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  briefingApplySchema,
  briefingProfileImportSchema,
  briefingProposalRequestSchema,
  briefingPutSchema,
  briefingSaveSchema,
  saveAnswerRequestSchema,
} from "@omnitech/interview-contracts";
import {
  parsePlaygroundPatch,
  type PlaygroundAnswerLanguage,
  type PlaygroundPatch,
} from "@omnitech/interview-playground-control";
import { Command } from "commander";

import { configPath, writeConfig } from "./config.js";
import {
  createConfiguredBriefingClient,
  createConfiguredClient,
  createConfiguredPlaygroundControlClient,
} from "./index.js";

type OutputFormat = "json" | "text";

function print(value: unknown, format: OutputFormat): void {
  if (format === "json" || typeof value !== "object") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value as Array<Record<string, unknown>>) {
      process.stdout.write(
        `${String(item["id"] ?? "")}\t${String(item["language"] ?? "")}\t${String(item["title"] ?? "")}\n`,
      );
    }
    return;
  }

  const record = value as Record<string, unknown>;
  process.stdout.write(
    `${String(record["answerMarkdown"] ?? record["code"] ?? JSON.stringify(value, null, 2))}\n`,
  );
}

function globalOptions(program: Command) {
  return program.opts<{
    format: OutputFormat;
    token?: string;
    url?: string;
  }>();
}

async function readQuestion(options: {
  file?: string;
  question?: string;
}): Promise<string> {
  if (options.question) return options.question;
  if (options.file) return readFile(options.file, "utf8");
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error(
    "Provide --question, --file, or pipe a question through stdin.",
  );
}

export function createProgram(): Command {
  const program = new Command()
    .name("interview-answers")
    .description(
      "Drive the interview playground without handling HTTP directly.",
    )
    .enablePositionalOptions()
    .option("--url <url>", "API URL")
    .option("--token <token>", "API token")
    .option("--format <format>", "text or json", "text");

  program
    .command("configure")
    .requiredOption("--url <url>")
    .requiredOption("--token <token>")
    .action(async (options: { token: string; url: string }) => {
      await writeConfig(options);
      process.stdout.write(`Saved CLI configuration to ${configPath}\n`);
    });

  const briefing = program
    .command("briefing")
    .description(
      "Review non-technical interview briefings. Propose, apply, and save are separate steps. Authenticated Next sessions may be required.",
    )
    .option("--tenant <tenant>", "tenant scope", "local");
  const briefingOptions = () => ({
    ...globalOptions(program),
    tenant: briefing.opts<{ tenant: string }>().tenant,
  });
  const briefingClient = () =>
    createConfiguredBriefingClient(briefingOptions());
  const readJson = async (file: string) =>
    JSON.parse(await readFile(file, "utf8")) as unknown;
  const revision = (value: string) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0)
      throw new Error("Revision must be a non-negative integer.");
    return parsed;
  };
  const printBriefing = (value: unknown) => print(value, "json");

  briefing
    .command("profiles")
    .action(async () =>
      printBriefing(await (await briefingClient()).listProfiles()),
    );
  briefing
    .command("import")
    .requiredOption("--file <path>")
    .requiredOption("--name <name>")
    .action(async (options: { file: string; name: string }) =>
      printBriefing(
        await (await briefingClient()).importProfile(
          briefingProfileImportSchema.parse({
            name: options.name,
            matrix: await readJson(options.file),
          }),
        ),
      ),
    );
  briefing
    .command("show")
    .requiredOption("--id <id>")
    .option("--revision <revision>")
    .action(async (options: { id: string; revision?: string }) =>
      printBriefing(
        options.revision === undefined
          ? await (await briefingClient()).getArtifact(options.id)
          : await (await briefingClient()).getProfile(
              options.id,
              revision(options.revision),
            ),
      ),
    );
  briefing
    .command("artifacts")
    .action(async () =>
      printBriefing(await (await briefingClient()).listArtifacts()),
    );
  briefing
    .command("edit")
    .requiredOption("--id <id>")
    .requiredOption("--file <path>")
    .action(async (options: { id: string; file: string }) =>
      printBriefing(
        await (await briefingClient()).editArtifact(
          options.id,
          briefingPutSchema.parse(await readJson(options.file)),
        ),
      ),
    );
  briefing
    .command("propose")
    .requiredOption("--id <id>")
    .requiredOption("--file <path>")
    .action(async (options: { id: string; file: string }) =>
      printBriefing(
        await (await briefingClient()).propose(
          options.id,
          briefingProposalRequestSchema.parse(await readJson(options.file)),
        ),
      ),
    );
  briefing
    .command("apply")
    .requiredOption("--id <id>")
    .requiredOption("--proposal <proposal>")
    .requiredOption("--revision <revision>")
    .action(
      async (options: { id: string; proposal: string; revision: string }) =>
        printBriefing(
          await (await briefingClient()).apply(
            options.id,
            briefingApplySchema.parse({
              proposalId: options.proposal,
              expectedRevision: revision(options.revision),
            }),
          ),
        ),
    );
  briefing
    .command("save")
    .requiredOption("--id <id>")
    .requiredOption("--revision <revision>")
    .requiredOption("--request-id <requestId>")
    .action(
      async (options: { id: string; revision: string; requestId: string }) =>
        printBriefing(
          await (await briefingClient()).save(
            options.id,
            briefingSaveSchema.parse({
              expectedRevision: revision(options.revision),
              requestId: options.requestId,
            }),
          ),
        ),
    );
  briefing.command("open").action(async () => {
    printBriefing(
      await (
        await createConfiguredPlaygroundControlClient(globalOptions(program))
      ).set({ view: "interview-preparation" }),
    );
  });

  program
    .command("ask")
    .option("-q, --question <question>")
    .option("-f, --file <path>")
    .option(
      "-l, --language <language>",
      "auto, php, react, typescript, or ruby",
      "auto",
    )
    .option("--save", "persist the generated answer")
    .option("--notes <notes>", "notes to persist with --save", "")
    .option("--tenant <tenant>", "tenant the answer is generated for", "local")
    .action(async (options) => {
      const globals = program.opts<{
        format: OutputFormat;
        token?: string;
        url?: string;
      }>();
      const client = await createConfiguredClient({
        ...globals,
        tenant: options.tenant,
      });
      const question = await readQuestion(options);
      const answer = await client.generate({
        question,
        language: options.language,
      });
      const output = options.save
        ? await client.saveAnswer({ ...answer, question, notes: options.notes })
        : answer;
      print(output, globals.format);
    });

  program
    .command("explain")
    .description(
      "Generate a concise interview briefing and open it in Concept Lab.",
    )
    .option("-t, --topic <topic>")
    .option("-f, --file <path>")
    .option("-c, --context <context>")
    .option("--append", "append as a collapsed Concept Lab follow-up")
    .option("--save", "persist the generated explanation")
    .option(
      "--tenant <tenant>",
      "tenant the explanation is generated for",
      "local",
    )
    .action(async (options) => {
      const globals = globalOptions(program);
      const topic = await readQuestion({
        question: options.topic,
        file: options.file,
      });
      const client = await createConfiguredClient({
        ...globals,
        tenant: options.tenant,
      });
      const explanation = await client.explain({
        topic,
        ...(options.context ? { context: options.context } : {}),
      });
      const output = options.save
        ? await client.saveExplanation({ ...explanation, topic })
        : explanation;
      const playground = await createConfiguredPlaygroundControlClient(globals);
      const draft = { ...explanation, topic };
      if (options.append) {
        await playground.appendExplanation(draft);
      } else {
        await playground.set({
          view: "concept-lab",
          explanation: draft,
        });
      }
      print(output, globals.format);
    });

  program.command("list").action(async () => {
    const globals = program.opts<{
      format: OutputFormat;
      token?: string;
      url?: string;
    }>();
    print(
      await (await createConfiguredClient(globals)).listAnswers(),
      globals.format,
    );
  });

  program.command("health").action(async () => {
    const globals = globalOptions(program);
    print(
      await (await createConfiguredClient(globals)).health(),
      globals.format,
    );
  });

  const playground = program
    .command("playground")
    .description(
      "Read or update the Playground: what Interview Studio shows next.",
    );

  playground
    .command("show")
    .option("--summary", "print only the active view and content title")
    .action(async (options: { summary?: boolean }) => {
      const globals = globalOptions(program);
      const snapshot = await (
        await createConfiguredPlaygroundControlClient(globals)
      ).get();
      if (options.summary) {
        const title =
          snapshot.value.explanation?.title ??
          snapshot.value.answer?.title ??
          "empty";
        process.stdout.write(`${snapshot.value.view}: ${title}\n`);
        return;
      }
      print(snapshot, globals.format);
    });

  playground
    .command("append-explanation")
    .description(
      "Append a collapsed follow-up to the concept explanations in Briefings.",
    )
    .requiredOption("--topic <topic>")
    .requiredOption("--title <title>")
    .requiredOption("--markdown-file <path>")
    .action(async (options) => {
      const globals = globalOptions(program);
      print(
        await (
          await createConfiguredPlaygroundControlClient(globals)
        ).appendExplanation({
          topic: options.topic,
          title: options.title,
          markdown: await readFile(options.markdownFile, "utf8"),
        }),
        globals.format,
      );
    });

  playground
    .command("set")
    .description(
      "Patch Playground controls with --file/stdin JSON or individual options.",
    )
    .option("-f, --file <path>", "JSON patch file")
    .option("-q, --question <question>")
    .option("-l, --language <language>")
    .option("--notes <notes>")
    .option("--panel <panel>", "notes, output, or saved")
    .option(
      "--view <view>",
      "playground (Workspace), concept-lab or interview-preparation (Briefings), or mock-interview (Rehearsal)",
    )
    .option("--title <title>", "answer title")
    .option("--guide-file <path>", "answer guide JSON file")
    .option("--code-file <path>")
    .option("--usage-code-file <path>")
    .option("--test-code-file <path>")
    .option("--clear-answer", "remove the answer from the Playground")
    .option("--quiet", "apply the patch without printing the resulting state")
    .action(async (options) => {
      const globals = globalOptions(program);
      let patch: PlaygroundPatch;
      const hasNamedOptions = [
        options.question,
        options.language,
        options.notes,
        options.panel,
        options.title,
        options.guideFile,
        options.codeFile,
        options.usageCodeFile,
        options.testCodeFile,
        options.clearAnswer,
        options.view,
      ].some((value) => value !== undefined && value !== false);

      if (options.file || (!hasNamedOptions && !process.stdin.isTTY)) {
        const json = options.file
          ? await readFile(options.file, "utf8")
          : await readQuestion({});
        patch = parsePlaygroundPatch(JSON.parse(json));
      } else {
        patch = parsePlaygroundPatch({
          ...(options.question === undefined
            ? {}
            : { question: options.question }),
          ...(options.language === undefined
            ? {}
            : { language: options.language }),
          ...(options.notes === undefined ? {} : { notes: options.notes }),
          ...(options.panel === undefined ? {} : { panel: options.panel }),
          ...(options.view === undefined ? {} : { view: options.view }),
        });

        const hasAnswerFields =
          options.title !== undefined ||
          options.guideFile !== undefined ||
          options.codeFile !== undefined ||
          options.usageCodeFile !== undefined ||
          options.testCodeFile !== undefined;
        if (options.clearAnswer && hasAnswerFields) {
          throw new Error(
            "--clear-answer cannot be combined with answer field options.",
          );
        }
        if (options.clearAnswer) patch.answer = null;

        if (hasAnswerFields) {
          if (
            !options.title ||
            !options.guideFile ||
            !options.codeFile ||
            !options.language ||
            options.language === "auto"
          ) {
            throw new Error(
              "An answer requires --title, --guide-file, --code-file, and a non-auto --language.",
            );
          }
          patch.answer = {
            title: options.title,
            language: options.language as PlaygroundAnswerLanguage,
            // The Playground renders the answer's Markdown from the guide.
            answerMarkdown: "",
            code: await readFile(options.codeFile, "utf8"),
            usageCode: options.usageCodeFile
              ? await readFile(options.usageCodeFile, "utf8")
              : "",
            testCode: options.testCodeFile
              ? await readFile(options.testCodeFile, "utf8")
              : "",
            guide: JSON.parse(await readFile(options.guideFile, "utf8")),
          };
        }
      }

      const snapshot = await (
        await createConfiguredPlaygroundControlClient(globals)
      ).set(patch);
      if (!options.quiet) print(snapshot, globals.format);
    });

  playground.command("reset").action(async () => {
    const globals = globalOptions(program);
    print(
      await (await createConfiguredPlaygroundControlClient(globals)).reset(),
      globals.format,
    );
  });

  const mockInterview = program
    .command("mock-interview")
    .description("Start, end or reset a Rehearsal in Interview Studio.");

  mockInterview
    .command("start")
    .option("--strict", "disable pausing for this session")
    .action(async (options: { strict?: boolean }) => {
      const globals = globalOptions(program);
      print(
        await (await createConfiguredPlaygroundControlClient(globals)).set({
          view: "mock-interview",
          mockInterview: {
            action: "start",
            strict: Boolean(options.strict),
          },
        }),
        globals.format,
      );
    });

  mockInterview.command("show").action(async () => {
    const globals = globalOptions(program);
    print(
      await (await createConfiguredPlaygroundControlClient(globals)).get(),
      globals.format,
    );
  });

  for (const action of ["end", "reset"] as const) {
    mockInterview.command(action).action(async () => {
      const globals = globalOptions(program);
      print(
        await (await createConfiguredPlaygroundControlClient(globals)).set({
          view: "mock-interview",
          mockInterview: { action, strict: false },
        }),
        globals.format,
      );
    });
  }

  program
    .command("route")
    .option("-q, --question <question>")
    .option("-f, --file <path>")
    .option(
      "-l, --language <language>",
      "auto, php, react, typescript, or ruby",
      "auto",
    )
    .action(async (options) => {
      const globals = program.opts<{
        format: OutputFormat;
        token?: string;
        url?: string;
      }>();
      print(
        await (await createConfiguredClient(globals)).route({
          question: await readQuestion(options),
          language: options.language,
        }),
        globals.format,
      );
    });

  program
    .command("save")
    .description(
      "Create or update an answer from JSON supplied by --file or stdin.",
    )
    .option("-f, --file <path>")
    .action(async (options: { file?: string }) => {
      const globals = program.opts<{
        format: OutputFormat;
        token?: string;
        url?: string;
      }>();
      const json = options.file
        ? await readFile(options.file, "utf8")
        : await readQuestion({});
      print(
        await (await createConfiguredClient(globals)).saveAnswer(
          saveAnswerRequestSchema.parse(JSON.parse(json)),
        ),
        globals.format,
      );
    });

  program.command("show <id>").action(async (id: string) => {
    const globals = program.opts<{
      format: OutputFormat;
      token?: string;
      url?: string;
    }>();
    print(
      await (await createConfiguredClient(globals)).getAnswer(id),
      globals.format,
    );
  });

  program
    .command("run")
    .requiredOption("-l, --language <language>")
    .option("-f, --file <path>")
    .option("-c, --code <code>")
    .option("--stdin <stdin>", "")
    .action(async (options) => {
      const globals = program.opts<{
        format: OutputFormat;
        token?: string;
        url?: string;
      }>();
      const code = options.file
        ? await readFile(options.file, "utf8")
        : options.code;
      if (!code) throw new Error("Provide --file or --code.");
      print(
        await (await createConfiguredClient(globals)).run({
          code,
          language: options.language,
          stdin: options.stdin,
        }),
        globals.format,
      );
    });

  return program;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  createProgram()
    .parseAsync()
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
