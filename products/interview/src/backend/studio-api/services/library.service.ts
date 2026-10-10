import type {
  LibraryItemInput,
  LibrarySearchQuery,
} from "@omnitech/interview-contracts";
import { libraryRepository, libraryService } from "../../services";

export function search(input: LibrarySearchQuery) {
  return libraryService.search(input);
}

export function facets() {
  return libraryService.facets();
}

export async function listItems(includeDrafts: boolean) {
  await libraryService.initialize();
  return includeDrafts
    ? libraryRepository.list()
    : libraryRepository.listPublished();
}

export async function getItem(identifier: string, includeDraft: boolean) {
  await libraryService.initialize();
  return includeDraft
    ? libraryRepository.get(identifier)
    : libraryRepository.getPublished(identifier);
}

export function saveDraft(input: LibraryItemInput, id?: string) {
  // Preserve the existing repository's one-argument create call.
  return id === undefined
    ? libraryRepository.saveDraft(input)
    : libraryRepository.saveDraft(input, id);
}

export async function publish(id: string) {
  const item = await libraryRepository.publish(id);
  if (!item) return item;
  await libraryService.synchronize();
  return item;
}

export async function archive(id: string) {
  const item = await libraryRepository.archive(id);
  if (!item) return item;
  await libraryService.synchronize();
  return item;
}

export function deleteDraft(id: string) {
  return libraryRepository.deleteDraft(id);
}
