import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  LibraryItem,
  LibraryItemInput,
  LibraryFacets,
  LibrarySearchQuery,
  LibrarySearchResponse,
} from "@omnitech/interview-contracts";
import type { LibrarySearchIndex } from "@omnitech/interview-library";
import type { LibraryRepository } from "@omnitech/interview-storage";

export class LibraryIndexUnavailableError extends Error {
  constructor() {
    super("The Library search index could not be loaded or rebuilt.");
    this.name = "LibraryIndexUnavailableError";
  }
}

export class LibraryService {
  private ready: Promise<void> | undefined;

  constructor(
    private readonly repository: LibraryRepository,
    private readonly index: LibrarySearchIndex,
    private readonly indexPath: string,
    private readonly seed: LibraryItemInput[] = [],
  ) {}

  async initialize(): Promise<void> {
    this.ready ??= this.initializeOnce().catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  async search(query: LibrarySearchQuery): Promise<LibrarySearchResponse> {
    await this.initialize();
    await this.ensureCurrentRevision();
    try {
      return await this.index.search(query);
    } catch {
      await this.rebuild();
      try {
        return await this.index.search(query);
      } catch {
        throw new LibraryIndexUnavailableError();
      }
    }
  }

  async synchronize(): Promise<void> {
    await this.rebuild();
  }

  async facets(): Promise<LibraryFacets> {
    await this.initialize();
    const items = await this.repository.listPublished();
    const facets: LibraryFacets = {
      contentTypes: {},
      collections: {},
      tags: {},
    };
    for (const item of items) {
      increment(facets.contentTypes, item.contentType);
      increment(facets.collections, item.collection);
      for (const tag of item.tags) increment(facets.tags, tag);
    }
    return facets;
  }

  private async initializeOnce(): Promise<void> {
    await this.synchronizeSeed();
    const revision = await this.repository.revision();
    if (await this.index.restore(this.indexPath, revision)) return;
    await this.rebuild();
  }

  private async synchronizeSeed(): Promise<void> {
    if (this.seed.length === 0) return;
    const existingSlugs = new Set(
      (await this.repository.list()).map((item) => item.slug),
    );
    for (const input of this.seed) {
      if (existingSlugs.has(input.slug)) continue;
      const draft = await this.repository.saveDraft(input);
      await this.repository.publish(draft.id);
    }
  }

  private async ensureCurrentRevision(): Promise<void> {
    if ((await this.repository.revision()) !== this.index.sourceRevision()) {
      await this.rebuild();
    }
  }

  private async rebuild(): Promise<void> {
    try {
      const [items, revision] = await Promise.all([
        this.repository.listPublished(),
        this.repository.revision(),
      ]);
      await this.index.rebuild(items, revision);
      await mkdir(dirname(this.indexPath), { recursive: true });
      await this.index.persist(this.indexPath);
    } catch {
      throw new LibraryIndexUnavailableError();
    }
  }
}

function increment(values: Record<string, number>, key: string): void {
  values[key] = (values[key] ?? 0) + 1;
}

export function isPublishedLibraryItem(
  item: LibraryItem | undefined,
): item is LibraryItem {
  return item?.status === "published";
}
