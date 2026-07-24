import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { JsonAnswerRepository } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("JsonAnswerRepository", () => {
  it("persists only when save is explicitly called", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interview-storage-"));
    temporaryDirectories.push(directory);
    const repository = new JsonAnswerRepository(directory);

    expect(await repository.list()).toEqual([]);

    const saved = await repository.save({
      title: "Simple answer",
      language: "typescript",
      answerMarkdown: "Use a map.",
      code: "export const answer = 1;",
      usageCode: "console.log(answer);",
      testCode: "",
      question: "Solve it",
      notes: "Review later",
    });

    expect((await repository.get(saved.id))?.notes).toBe("Review later");
  });

  it("updates an existing answer without changing its identity or creation time", async () => {
    vi.useFakeTimers();
    const directory = await mkdtemp(join(tmpdir(), "interview-storage-"));
    temporaryDirectories.push(directory);
    const repository = new JsonAnswerRepository(directory);
    vi.setSystemTime("2026-07-23T00:00:00.000Z");
    const original = await repository.save(answerInput());
    vi.setSystemTime("2026-07-24T00:00:00.000Z");

    const updated = await repository.save({
      ...answerInput(),
      id: original.id,
      notes: "Updated notes",
    });

    expect(updated).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      updatedAt: "2026-07-24T00:00:00.000Z",
      notes: "Updated notes",
    });
    expect(await repository.list()).toEqual([updated]);
    vi.useRealTimers();
  });

  it("keeps a caller-supplied id for a new answer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interview-storage-"));
    temporaryDirectories.push(directory);
    const repository = new JsonAnswerRepository(directory);
    const id = "01957fcb-06e8-7a1a-a351-cf7225f9d342";

    const saved = await repository.save({ ...answerInput(), id });

    expect(saved.id).toBe(id);
  });

  it("lists answers by most recent update", async () => {
    vi.useFakeTimers();
    const directory = await mkdtemp(join(tmpdir(), "interview-storage-"));
    temporaryDirectories.push(directory);
    const repository = new JsonAnswerRepository(directory);
    vi.setSystemTime("2026-07-23T00:00:00.000Z");
    const first = await repository.save({
      ...answerInput(),
      title: "First",
    });
    vi.setSystemTime("2026-07-24T00:00:00.000Z");
    const second = await repository.save({
      ...answerInput(),
      title: "Second",
    });

    expect((await repository.list()).map(({ id }) => id)).toEqual([
      second.id,
      first.id,
    ]);
    vi.useRealTimers();
  });

  it("deletes an existing answer and reports missing ids", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interview-storage-"));
    temporaryDirectories.push(directory);
    const repository = new JsonAnswerRepository(directory);
    const saved = await repository.save(answerInput());

    await expect(repository.delete("missing")).resolves.toBe(false);
    await expect(repository.delete(saved.id)).resolves.toBe(true);
    await expect(repository.get(saved.id)).resolves.toBeUndefined();
  });

  it("returns a page with newest-first items and metadata", async () => {
    vi.useFakeTimers();
    const directory = await mkdtemp(join(tmpdir(), "interview-storage-"));
    temporaryDirectories.push(directory);
    const repository = new JsonAnswerRepository(directory);
    vi.setSystemTime("2026-07-23T00:00:00.000Z");
    const first = await repository.save({ ...answerInput(), title: "First" });
    vi.setSystemTime("2026-07-24T00:00:00.000Z");
    const second = await repository.save({ ...answerInput(), title: "Second" });
    vi.setSystemTime("2026-07-25T00:00:00.000Z");
    await repository.save({ ...answerInput(), title: "Third" });

    const page = await repository.listPage(2, 1);
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 1 });
    expect(page.items).toEqual([second]);
    expect(first.id).not.toBe(second.id);
    vi.useRealTimers();
  });

  it("writes private, readable JSON with a trailing newline", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interview-storage-"));
    temporaryDirectories.push(directory);
    const repository = new JsonAnswerRepository(directory);

    await repository.save(answerInput());
    const content = await readFile(repository.filePath, "utf8");

    expect(content.endsWith("\n")).toBe(true);
    expect(JSON.parse(content)).toHaveLength(1);
  });

  it("propagates malformed persisted JSON instead of hiding corruption", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interview-storage-"));
    temporaryDirectories.push(directory);
    const repository = new JsonAnswerRepository(directory);
    await writeFile(repository.filePath, "{not-json");

    await expect(repository.list()).rejects.toBeInstanceOf(SyntaxError);
  });
});

function answerInput() {
  return {
    title: "Simple answer",
    language: "typescript" as const,
    answerMarkdown: "Use a map.",
    code: "export const answer = 1;",
    usageCode: "console.log(answer);",
    testCode: "",
    question: "Solve it",
    notes: "Review later",
  };
}
