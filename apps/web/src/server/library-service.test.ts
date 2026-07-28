import type {
  LibraryItem,
  LibraryItemInput,
  LibrarySearchQuery,
} from "@omnitech/interview-contracts";
import type { LibrarySearchIndex } from "@omnitech/interview-library";
import type { LibraryRepository } from "@omnitech/interview-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LibraryIndexUnavailableError,
  LibraryService,
} from "./library-service";

const mocks = {
  archive: vi.fn(),
  deleteDraft: vi.fn(),
  get: vi.fn(),
  getPublished: vi.fn(),
  list: vi.fn(),
  listPublished: vi.fn(),
  publish: vi.fn(),
  revision: vi.fn(),
  saveDraft: vi.fn(),
  persist: vi.fn(),
  rebuild: vi.fn(),
  restore: vi.fn(),
  search: vi.fn(),
  sourceRevision: vi.fn(),
};

const repository: LibraryRepository = {
  archive: mocks.archive,
  deleteDraft: mocks.deleteDraft,
  get: mocks.get,
  getPublished: mocks.getPublished,
  list: mocks.list,
  listPublished: mocks.listPublished,
  publish: mocks.publish,
  revision: mocks.revision,
  saveDraft: mocks.saveDraft,
};

const index: LibrarySearchIndex = {
  persist: mocks.persist,
  rebuild: mocks.rebuild,
  restore: mocks.restore,
  search: mocks.search,
  sourceRevision: mocks.sourceRevision,
};

describe("LibraryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([item()]);
    mocks.listPublished.mockResolvedValue([item()]);
    mocks.revision.mockResolvedValue(4);
    mocks.restore.mockResolvedValue(true);
    mocks.sourceRevision.mockReturnValue(4);
    mocks.search.mockResolvedValue({
      hits: [],
      total: 0,
      elapsedMs: 1,
      facets: { contentTypes: {}, collections: {}, tags: {} },
    });
  });

  it("loads a current persisted index once and serves searches", async () => {
    const service = new LibraryService(repository, index, "/tmp/index.msp");
    const query = searchQuery();

    await service.search(query);
    await service.search(query);

    expect(mocks.restore).toHaveBeenCalledOnce();
    expect(mocks.rebuild).not.toHaveBeenCalled();
    expect(mocks.search).toHaveBeenCalledTimes(2);
  });

  it("rebuilds missing indexes and stale indexes from published records", async () => {
    mocks.restore.mockResolvedValue(false);
    const service = new LibraryService(repository, index, "/tmp/index.msp");
    await service.initialize();
    expect(mocks.rebuild).toHaveBeenCalledWith([item()], 4);
    expect(mocks.persist).toHaveBeenCalledWith("/tmp/index.msp");

    mocks.sourceRevision.mockReturnValue(3);
    await service.search(searchQuery());
    expect(mocks.rebuild).toHaveBeenCalledTimes(2);
  });

  it("seeds an empty repository before building its index", async () => {
    const seed = [input()];
    const draft = item({ status: "draft" });
    mocks.list.mockResolvedValue([]);
    mocks.saveDraft.mockResolvedValue(draft);
    mocks.publish.mockResolvedValue(item());
    mocks.restore.mockResolvedValue(false);
    const service = new LibraryService(
      repository,
      index,
      "/tmp/index.msp",
      seed,
    );

    await service.initialize();

    expect(mocks.saveDraft).toHaveBeenCalledWith(seed[0]);
    expect(mocks.publish).toHaveBeenCalledWith(draft.id);
  });

  it("adds missing bundled references without overwriting existing items", async () => {
    const existing = input();
    const added = { ...input(), slug: "react-effects", title: "React effects" };
    const draft = item({
      ...added,
      id: "123e4567-e89b-42d3-a456-426614174001",
      status: "draft",
    });
    mocks.list.mockResolvedValue([item()]);
    mocks.saveDraft.mockResolvedValue(draft);
    mocks.publish.mockResolvedValue(item(added));
    const service = new LibraryService(repository, index, "/tmp/index.msp", [
      existing,
      added,
    ]);

    await service.initialize();

    expect(mocks.saveDraft).toHaveBeenCalledOnce();
    expect(mocks.saveDraft).toHaveBeenCalledWith(added);
    expect(mocks.publish).toHaveBeenCalledWith(draft.id);
  });

  it("maps rebuild failures and allows initialization to be retried", async () => {
    mocks.restore.mockResolvedValue(false);
    mocks.rebuild.mockRejectedValueOnce(new Error("corrupt"));
    const service = new LibraryService(repository, index, "/tmp/index.msp");

    await expect(service.initialize()).rejects.toBeInstanceOf(
      LibraryIndexUnavailableError,
    );
    await expect(service.initialize()).resolves.toBeUndefined();
    expect(mocks.restore).toHaveBeenCalledTimes(2);
  });

  it("synchronizes explicitly after mutations", async () => {
    const service = new LibraryService(repository, index, "/tmp/index.msp");
    await service.synchronize();
    expect(mocks.rebuild).toHaveBeenCalledWith([item()], 4);
  });

  it("counts published documents rather than indexed sections in facets", async () => {
    mocks.listPublished.mockResolvedValue([
      item(),
      item({
        id: "123e4567-e89b-42d3-a456-426614174001",
        slug: "backend",
        collection: "backend",
        tags: ["backend", "state"],
      }),
    ]);
    const service = new LibraryService(repository, index, "/tmp/index.msp");
    await expect(service.facets()).resolves.toEqual({
      contentTypes: { "concept-guide": 2 },
      collections: { react: 1, backend: 1 },
      tags: { react: 1, state: 1, backend: 1 },
    });
  });

  it("rebuilds once when an apparently current index cannot search", async () => {
    mocks.search
      .mockRejectedValueOnce(new Error("schema changed"))
      .mockResolvedValueOnce({
        hits: [],
        total: 0,
        elapsedMs: 1,
        facets: { contentTypes: {}, collections: {}, tags: {} },
      });
    const service = new LibraryService(repository, index, "/tmp/index.msp");
    await expect(service.search(searchQuery())).resolves.toMatchObject({
      total: 0,
    });
    expect(mocks.rebuild).toHaveBeenCalledOnce();

    mocks.search.mockRejectedValue(new Error("still corrupt"));
    await expect(service.search(searchQuery())).rejects.toBeInstanceOf(
      LibraryIndexUnavailableError,
    );
  });
});

function searchQuery(): LibrarySearchQuery {
  return {
    query: "React",
    contentTypes: [],
    collections: [],
    tags: [],
    officialOnly: false,
    offset: 0,
    limit: 20,
  };
}

function input(): LibraryItemInput {
  return {
    slug: "react-state",
    title: "React state",
    summary: "State snapshots.",
    body: "# State",
    contentType: "concept-guide",
    collection: "react",
    tags: ["react"],
  };
}

function item(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    ...input(),
    id: "123e4567-e89b-42d3-a456-426614174000",
    status: "published",
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    publishedAt: "2026-07-27T00:00:00.000Z",
    revision: 1,
    ...overrides,
  };
}
