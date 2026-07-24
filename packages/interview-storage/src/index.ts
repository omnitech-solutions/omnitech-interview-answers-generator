import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  SaveAnswerRequest,
  SavedAnswer,
} from "@omnitech/interview-contracts";

export interface AnswerRepository {
  delete(id: string): Promise<boolean>;
  get(id: string): Promise<SavedAnswer | undefined>;
  list(): Promise<SavedAnswer[]>;
  save(input: SaveAnswerRequest): Promise<SavedAnswer>;
}

export class JsonAnswerRepository implements AnswerRepository {
  readonly filePath: string;

  constructor(dataDirectory: string) {
    this.filePath = join(dataDirectory, "answers.json");
  }

  async list(): Promise<SavedAnswer[]> {
    const answers = await this.readAll();
    return answers.toSorted((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async get(id: string): Promise<SavedAnswer | undefined> {
    return (await this.readAll()).find((answer) => answer.id === id);
  }

  async save(input: SaveAnswerRequest): Promise<SavedAnswer> {
    const answers = await this.readAll();
    const now = new Date().toISOString();
    const existingIndex = input.id
      ? answers.findIndex((answer) => answer.id === input.id)
      : -1;
    const existing = existingIndex >= 0 ? answers[existingIndex] : undefined;
    const saved: SavedAnswer = {
      ...input,
      id: existing?.id ?? input.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      answers[existingIndex] = saved;
    } else {
      answers.push(saved);
    }

    await this.writeAll(answers);
    return saved;
  }

  async delete(id: string): Promise<boolean> {
    const answers = await this.readAll();
    const remaining = answers.filter((answer) => answer.id !== id);
    if (remaining.length === answers.length) return false;
    await this.writeAll(remaining);
    return true;
  }

  private async readAll(): Promise<SavedAnswer[]> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return JSON.parse(content) as SavedAnswer[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeAll(answers: SavedAnswer[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(answers, null, 2)}\n`, {
      mode: 0o600,
    });
    // Atomic replacement prevents a partially written JSON file after a crash.
    await rename(temporaryPath, this.filePath);
  }
}
