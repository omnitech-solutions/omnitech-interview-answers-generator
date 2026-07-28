import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  JsonAnswerRepository,
  JsonExplanationRepository,
  JsonLibraryRepository,
  LibrarySlugConflictError,
  LibraryStateError,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("JsonExplanationRepository", () => {
  it("creates, updates, sorts, and deletes explanations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interview-storage-"));
    temporaryDirectories.push(directory);
    const repository = new JsonExplanationRepository(directory);
    expect(await repository.list()).toEqual([]);
    const first = await repository.save({
      topic: "React",
      title: "React",
      markdown: "First",
    });
    const updated = await repository.save({
      id: first.id,
      topic: "React",
      title: "React lifecycle",
      markdown: "Updated",
    });
    expect(updated.createdAt).toBe(first.createdAt);
    expect(await repository.get(first.id)).toEqual(updated);
    expect(await repository.delete("missing")).toBe(false);
    expect(await repository.delete(first.id)).toBe(true);
    expect(await repository.get(first.id)).toBeUndefined();
  });

  it("preserves supplied ids and surfaces malformed JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interview-storage-"));
    temporaryDirectories.push(directory);
    const repository = new JsonExplanationRepository(directory);
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(
      (
        await repository.save({
          id,
          topic: "Queues",
          title: "Queues",
          markdown: "FIFO",
        })
      ).id,
    ).toBe(id);
    await writeFile(repository.filePath, "{broken");
    await expect(repository.list()).rejects.toBeInstanceOf(SyntaxError);
  });
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

describe("JsonLibraryRepository", () => {
  it("keeps drafts out of published reads and increments source revisions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interview-library-"));
    temporaryDirectories.push(directory);
    const repository = new JsonLibraryRepository(directory);

    const draft = await repository.saveDraft(libraryInput());
    expect(await repository.revision()).toBe(0);
    expect(await repository.listPublished()).toEqual([]);
    expect(await repository.get(draft.slug)).toEqual(draft);
    expect(await repository.getPublished(draft.slug)).toBeUndefined();

    const published = await repository.publish(draft.id);
    expect(published).toMatchObject({ status: "published", revision: 2 });
    expect(await repository.revision()).toBe(1);
    expect(await repository.getPublished(draft.slug)).toEqual(published);
  });

  it("preserves the published snapshot while a revision is drafted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interview-library-"));
    temporaryDirectories.push(directory);
    const repository = new JsonLibraryRepository(directory);
    const draft = await repository.saveDraft(libraryInput());
    const published = await repository.publish(draft.id);
    const revised = await repository.saveDraft(
      { ...libraryInput(), title: "Revised title" },
      draft.id,
    );

    expect(revised.status).toBe("draft");
    expect((await repository.getPublished(draft.id))?.title).toBe(
      published?.title,
    );
    expect((await repository.get(draft.id))?.title).toBe("Revised title");
    expect(await repository.revision()).toBe(1);
  });

  it("archives published content and only deletes never-published drafts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interview-library-"));
    temporaryDirectories.push(directory);
    const repository = new JsonLibraryRepository(directory);
    const deletable = await repository.saveDraft({
      ...libraryInput(),
      slug: "delete-me",
    });
    expect(await repository.deleteDraft("missing")).toBe(false);
    expect(await repository.deleteDraft(deletable.id)).toBe(true);

    const draft = await repository.saveDraft(libraryInput());
    await repository.publish(draft.id);
    await expect(repository.deleteDraft(draft.id)).rejects.toBeInstanceOf(
      LibraryStateError,
    );
    const archived = await repository.archive(draft.id);
    expect(archived?.status).toBe("archived");
    expect(await repository.getPublished(draft.id)).toBeUndefined();
    expect(await repository.revision()).toBe(2);
    await expect(repository.archive("missing")).resolves.toBeUndefined();
  });

  it("rejects conflicts and missing updates and surfaces malformed files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interview-library-"));
    temporaryDirectories.push(directory);
    const repository = new JsonLibraryRepository(directory);
    await repository.saveDraft(libraryInput());
    await expect(repository.saveDraft(libraryInput())).rejects.toBeInstanceOf(
      LibrarySlugConflictError,
    );
    await expect(
      repository.saveDraft(libraryInput(), "missing"),
    ).rejects.toBeInstanceOf(LibraryStateError);
    await expect(
      repository.saveDraft({
        ...libraryInput(),
        slug: "invalid",
        tags: [],
      }),
    ).rejects.toThrow();
    expect(await repository.publish("missing")).toBeUndefined();

    await writeFile(repository.filePath, "{broken");
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

function libraryInput() {
  return {
    slug: "react-state",
    title: "React state",
    summary: "State ownership and snapshots.",
    body: "# State\n\nKeep one source of truth.",
    contentType: "concept-guide" as const,
    collection: "react",
    tags: ["react", "state"],
  };
}
