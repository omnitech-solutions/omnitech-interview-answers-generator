#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { saveAnswerRequestSchema } from "@omnitech/interview-contracts";
import {
  parsePlaygroundPatch,
  type PlaygroundAnswerLanguage,
  type PlaygroundPatch,
} from "@omnitech/interview-playground-control";
import { Command } from "commander";

import { configPath, writeConfig } from "./config.js";
import {
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
    .action(async (options) => {
      const globals = program.opts<{
        format: OutputFormat;
        token?: string;
        url?: string;
      }>();
      const client = await createConfiguredClient(globals);
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
    .description("Read or update the open Playground form.");

  playground.command("show").action(async () => {
    const globals = globalOptions(program);
    print(
      await (await createConfiguredPlaygroundControlClient(globals)).get(),
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
    .option("--title <title>", "answer title")
    .option("--answer-markdown <markdown>")
    .option("--code-file <path>")
    .option("--usage-code-file <path>")
    .option("--test-code-file <path>")
    .option("--clear-answer", "remove the answer from the Playground")
    .action(async (options) => {
      const globals = globalOptions(program);
      let patch: PlaygroundPatch;
      const hasNamedOptions = [
        options.question,
        options.language,
        options.notes,
        options.panel,
        options.title,
        options.answerMarkdown,
        options.codeFile,
        options.usageCodeFile,
        options.testCodeFile,
        options.clearAnswer,
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
        });

        const hasAnswerFields =
          options.title !== undefined ||
          options.answerMarkdown !== undefined ||
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
            !options.answerMarkdown ||
            !options.codeFile ||
            !options.language ||
            options.language === "auto"
          ) {
            throw new Error(
              "An answer requires --title, --answer-markdown, --code-file, and a non-auto --language.",
            );
          }
          patch.answer = {
            title: options.title,
            language: options.language as PlaygroundAnswerLanguage,
            answerMarkdown: options.answerMarkdown,
            code: await readFile(options.codeFile, "utf8"),
            usageCode: options.usageCodeFile
              ? await readFile(options.usageCodeFile, "utf8")
              : "",
            testCode: options.testCodeFile
              ? await readFile(options.testCodeFile, "utf8")
              : "",
          };
        }
      }

      print(
        await (await createConfiguredPlaygroundControlClient(globals)).set(
          patch,
        ),
        globals.format,
      );
    });

  playground.command("reset").action(async () => {
    const globals = globalOptions(program);
    print(
      await (await createConfiguredPlaygroundControlClient(globals)).reset(),
      globals.format,
    );
  });

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
