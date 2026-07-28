import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  libraryItemInputSchema,
  type LibraryItem,
  type LibraryItemInput,
  type SaveAnswerRequest,
  type SaveExplanationRequest,
  type SavedAnswer,
  type SavedExplanation,
} from "@omnitech/interview-contracts";

interface StoredLibraryItem {
  item: LibraryItem;
  published?: LibraryItem;
}

interface LibraryFile {
  revision: number;
  items: StoredLibraryItem[];
}

export class LibrarySlugConflictError extends Error {
  constructor(readonly slug: string) {
    super(`A Library item with slug "${slug}" already exists.`);
    this.name = "LibrarySlugConflictError";
  }
}

export class LibraryStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibraryStateError";
  }
}

export interface LibraryRepository {
  archive(id: string): Promise<LibraryItem | undefined>;
  deleteDraft(id: string): Promise<boolean>;
  get(idOrSlug: string): Promise<LibraryItem | undefined>;
  getPublished(idOrSlug: string): Promise<LibraryItem | undefined>;
  list(): Promise<LibraryItem[]>;
  listPublished(): Promise<LibraryItem[]>;
  publish(id: string): Promise<LibraryItem | undefined>;
  revision(): Promise<number>;
  saveDraft(input: LibraryItemInput, id?: string): Promise<LibraryItem>;
}

export class JsonLibraryRepository implements LibraryRepository {
  readonly filePath: string;

  constructor(dataDirectory: string) {
    this.filePath = join(dataDirectory, "library.json");
  }

  async list(): Promise<LibraryItem[]> {
    return (await this.read()).items
      .map(({ item }) => item)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listPublished(): Promise<LibraryItem[]> {
    return (await this.read()).items
      .flatMap(({ published }) => (published ? [published] : []))
      .toSorted((left, right) => left.title.localeCompare(right.title));
  }

  async get(idOrSlug: string): Promise<LibraryItem | undefined> {
    return (await this.read()).items.find(
      ({ item }) => item.id === idOrSlug || item.slug === idOrSlug,
    )?.item;
  }

  async getPublished(idOrSlug: string): Promise<LibraryItem | undefined> {
    return (await this.read()).items.find(
      ({ item, published }) =>
        item.id === idOrSlug || published?.slug === idOrSlug,
    )?.published;
  }

  async revision(): Promise<number> {
    return (await this.read()).revision;
  }

  async saveDraft(input: LibraryItemInput, id?: string): Promise<LibraryItem> {
    const validatedInput = libraryItemInputSchema.parse(input);
    const file = await this.read();
    const index = id ? file.items.findIndex(({ item }) => item.id === id) : -1;
    const stored = index >= 0 ? file.items[index] : undefined;
    if (id && !stored) {
      throw new LibraryStateError("The Library item was not found.");
    }
    const duplicate = file.items.find(
      ({ item }) => item.slug === validatedInput.slug && item.id !== id,
    );
    if (duplicate) throw new LibrarySlugConflictError(validatedInput.slug);

    const now = new Date().toISOString();
    const item: LibraryItem = {
      ...validatedInput,
      id: stored?.item.id ?? randomUUID(),
      status: "draft",
      createdAt: stored?.item.createdAt ?? now,
      updatedAt: now,
      revision: (stored?.item.revision ?? 0) + 1,
      ...(stored?.item.publishedAt
        ? { publishedAt: stored.item.publishedAt }
        : {}),
    };
    const next: StoredLibraryItem = {
      item,
      ...(stored?.published ? { published: stored.published } : {}),
    };
    if (index >= 0) file.items[index] = next;
    else file.items.push(next);
    await this.write({ ...file, items: file.items });
    return item;
  }

  async publish(id: string): Promise<LibraryItem | undefined> {
    const file = await this.read();
    const stored = file.items.find(({ item }) => item.id === id);
    if (!stored) return undefined;
    libraryItemInputSchema.parse(stored.item);
    const now = new Date().toISOString();
    const published: LibraryItem = {
      ...stored.item,
      status: "published",
      updatedAt: now,
      publishedAt: stored.item.publishedAt ?? now,
      revision: stored.item.revision + 1,
    };
    stored.item = published;
    stored.published = published;
    await this.write({
      revision: file.revision + 1,
      items: file.items,
    });
    return published;
  }

  async archive(id: string): Promise<LibraryItem | undefined> {
    const file = await this.read();
    const stored = file.items.find(({ item }) => item.id === id);
    if (!stored) return undefined;
    const item: LibraryItem = {
      ...stored.item,
      status: "archived",
      updatedAt: new Date().toISOString(),
      revision: stored.item.revision + 1,
    };
    stored.item = item;
    delete stored.published;
    await this.write({
      revision: file.revision + 1,
      items: file.items,
    });
    return item;
  }

  async deleteDraft(id: string): Promise<boolean> {
    const file = await this.read();
    const stored = file.items.find(({ item }) => item.id === id);
    if (!stored) return false;
    if (stored.published || stored.item.status !== "draft") {
      throw new LibraryStateError("Only unpublished drafts can be deleted.");
    }
    await this.write({
      ...file,
      items: file.items.filter(({ item }) => item.id !== id),
    });
    return true;
  }

  private async read(): Promise<LibraryFile> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as LibraryFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { revision: 0, items: [] };
      }
      throw error;
    }
  }

  private async write(file: LibraryFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}

export interface AnswerRepository {
  delete(id: string): Promise<boolean>;
  get(id: string): Promise<SavedAnswer | undefined>;
  list(): Promise<SavedAnswer[]>;
  listPage(page: number, pageSize: number): Promise<AnswerPage>;
  save(input: SaveAnswerRequest): Promise<SavedAnswer>;
}

export class JsonExplanationRepository {
  readonly filePath: string;

  constructor(dataDirectory: string) {
    this.filePath = join(dataDirectory, "explanations.json");
  }

  async list(): Promise<SavedExplanation[]> {
    return (await this.readAll()).toSorted((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async get(id: string): Promise<SavedExplanation | undefined> {
    return (await this.readAll()).find((item) => item.id === id);
  }

  async save(input: SaveExplanationRequest): Promise<SavedExplanation> {
    const items = await this.readAll();
    const now = new Date().toISOString();
    const index = input.id
      ? items.findIndex((item) => item.id === input.id)
      : -1;
    const existing = index >= 0 ? items[index] : undefined;
    const saved: SavedExplanation = {
      ...input,
      id: existing?.id ?? input.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (index >= 0) items[index] = saved;
    else items.push(saved);
    await this.writeAll(items);
    return saved;
  }

  async delete(id: string): Promise<boolean> {
    const items = await this.readAll();
    const remaining = items.filter((item) => item.id !== id);
    if (remaining.length === items.length) return false;
    await this.writeAll(remaining);
    return true;
  }

  private async readAll(): Promise<SavedExplanation[]> {
    try {
      return JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as SavedExplanation[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeAll(items: SavedExplanation[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(items, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}

export interface AnswerPage {
  items: SavedAnswer[];
  total: number;
  page: number;
  pageSize: number;
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

  async listPage(page: number, pageSize: number): Promise<AnswerPage> {
    const answers = await this.list();
    const start = (page - 1) * pageSize;
    return {
      items: answers.slice(start, start + pageSize),
      total: answers.length,
      page,
      pageSize,
    };
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
      const answers = JSON.parse(content) as Array<
        SavedAnswer & { usageCode?: string }
      >;
      return answers.map((answer) => ({
        ...answer,
        usageCode: answer.usageCode ?? "",
      }));
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
