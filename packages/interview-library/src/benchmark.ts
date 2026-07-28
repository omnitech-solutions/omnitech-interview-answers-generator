import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  LibraryItem,
  LibrarySearchQuery,
} from "@omnitech/interview-contracts";

import { OramaLibrarySearchIndex } from "./index.js";

const itemCount = 1_000;
const sectionsPerItem = 10;
const query: LibrarySearchQuery = {
  query: "ownership",
  contentTypes: [],
  collections: [],
  tags: [],
  officialOnly: false,
  offset: 0,
  limit: 20,
};

const items = Array.from({ length: itemCount }, (_, itemIndex) =>
  fixtureItem(itemIndex),
);
const directory = await mkdtemp(join(tmpdir(), "library-benchmark-"));
const indexPath = join(directory, "library.msp");

try {
  const index = new OramaLibrarySearchIndex();
  await index.rebuild(items, 1);
  await index.persist(indexPath);

  const restored = new OramaLibrarySearchIndex();
  const restoreStarted = performance.now();
  await restored.restore(indexPath, 1);
  const restoreMs = performance.now() - restoreStarted;

  const representativeResult = await restored.search(query);
  if (representativeResult.total === 0) {
    throw new Error(
      "The benchmark query must match the deterministic fixture.",
    );
  }
  for (let warmup = 0; warmup < 10; warmup += 1) {
    await restored.search(query);
  }
  const samples: number[] = [];
  for (let sample = 0; sample < 100; sample += 1) {
    const started = performance.now();
    await restored.search(query);
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;

  console.log(
    JSON.stringify(
      {
        fixture: {
          items: itemCount,
          sections: itemCount * sectionsPerItem,
          matchedSections: representativeResult.total,
        },
        warmSearchP95Ms: Number(p95.toFixed(2)),
        persistedRestoreMs: Number(restoreMs.toFixed(2)),
        targets: { warmSearchP95Ms: 50, persistedRestoreMs: 250 },
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

function fixtureItem(index: number): LibraryItem {
  const body = Array.from(
    { length: sectionsPerItem },
    (_, section) =>
      `## P${section}\n\n${
        index % 50 === 0 ? "ownership" : "reference"
      } ${index}-${section}.`,
  ).join("\n\n");
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    slug: `fixture-${index}`,
    title: `F${index}`,
    summary: "Benchmark.",
    body,
    contentType: "concept-guide",
    collection: index % 2 === 0 ? "react" : "backend",
    tags: ["benchmark", index % 2 === 0 ? "react" : "backend"],
    status: "published",
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    publishedAt: "2026-07-27T00:00:00.000Z",
    revision: 1,
  };
}
