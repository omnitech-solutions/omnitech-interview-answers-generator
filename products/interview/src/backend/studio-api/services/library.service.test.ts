import { beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({
  initialize: vi.fn(),
  list: vi.fn(),
  listPublished: vi.fn(),
  get: vi.fn(),
  getPublished: vi.fn(),
  saveDraft: vi.fn(),
  publish: vi.fn(),
  archive: vi.fn(),
  synchronize: vi.fn(),
  deleteDraft: vi.fn(),
  search: vi.fn(),
  facets: vi.fn(),
}));

vi.mock("../../services", () => ({
  libraryRepository: {
    list: held.list,
    listPublished: held.listPublished,
    get: held.get,
    getPublished: held.getPublished,
    saveDraft: held.saveDraft,
    publish: held.publish,
    archive: held.archive,
    deleteDraft: held.deleteDraft,
  },
  libraryService: {
    initialize: held.initialize,
    synchronize: held.synchronize,
    search: held.search,
    facets: held.facets,
  },
}));

import * as library from "./library.service";

beforeEach(() => vi.resetAllMocks());

describe("Library read ordering", () => {
  it.each([true, false])(
    "initializes before listing, drafts=%s",
    async (drafts) => {
      const result = [{ id: "item" }];
      const read = drafts ? held.list : held.listPublished;
      held.initialize.mockImplementation(async () => {
        expect(read).not.toHaveBeenCalled();
      });
      read.mockImplementation(async () => {
        expect(held.initialize).toHaveBeenCalledOnce();
        return result;
      });
      expect(await library.listItems(drafts)).toBe(result);
      expect(drafts ? held.listPublished : held.list).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "initializes before reading an item, draft=%s",
    async (draft) => {
      const read = draft ? held.get : held.getPublished;
      const result = { id: "item" };
      read.mockImplementation(async (id) => {
        expect(held.initialize).toHaveBeenCalledOnce();
        expect(id).toBe("item");
        return result;
      });
      expect(await library.getItem("item", draft)).toBe(result);
      expect(draft ? held.getPublished : held.get).not.toHaveBeenCalled();
    },
  );

  it("does not read records after initialization fails", async () => {
    const failure = new Error("index failure");
    held.initialize.mockRejectedValue(failure);
    await expect(library.listItems(true)).rejects.toBe(failure);
    await expect(library.getItem("item", false)).rejects.toBe(failure);
    expect(held.list).not.toHaveBeenCalled();
    expect(held.getPublished).not.toHaveBeenCalled();
  });
});

describe.each(["publish", "archive"] as const)(
  "Library %s ordering",
  (operation) => {
    const mutate = operation === "publish" ? library.publish : library.archive;
    it("waits for persistence before rebuilding the index", async () => {
      const order: string[] = [];
      const item = { id: "item" };
      held[operation].mockImplementation(async () => {
        order.push("write");
        await Promise.resolve();
        order.push("written");
        return item;
      });
      held.synchronize.mockImplementation(async () => {
        order.push("sync");
      });
      expect(await mutate("item")).toBe(item);
      expect(held[operation]).toHaveBeenCalledWith("item");
      expect(order).toEqual(["write", "written", "sync"]);
    });

    it("skips index synchronization for a missing item", async () => {
      held[operation].mockResolvedValue(null);
      expect(await mutate("missing")).toBeNull();
      expect(held.synchronize).not.toHaveBeenCalled();
    });

    it("propagates persistence failure without rebuilding", async () => {
      const failure = new Error("persistence failure");
      held[operation].mockRejectedValue(failure);
      await expect(mutate("item")).rejects.toBe(failure);
      expect(held.synchronize).not.toHaveBeenCalled();
    });

    it("preserves an index error after persistence has completed", async () => {
      held[operation].mockResolvedValue({ id: "item" });
      const failure = new Error("index failure");
      held.synchronize.mockRejectedValue(failure);
      await expect(mutate("item")).rejects.toBe(failure);
      expect(held[operation]).toHaveBeenCalledOnce();
      expect(held.synchronize).toHaveBeenCalledOnce();
    });
  },
);

it("preserves create versus update repository arguments", async () => {
  const input = {
    slug: "state",
    title: "State",
    summary: "State ownership",
    body: "Keep state local",
    contentType: "concept-guide" as const,
    collection: "react",
    tags: ["react"],
  };
  await library.saveDraft(input);
  expect(held.saveDraft).toHaveBeenLastCalledWith(input);
  await library.saveDraft(input, "item");
  expect(held.saveDraft).toHaveBeenLastCalledWith(input, "item");
});
