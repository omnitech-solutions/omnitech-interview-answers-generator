import type {
  CreatePresentationInput,
  SavePresentationInput,
  Slide,
  TenantContext,
} from "../domain/index.js";
import { PresentationRepository } from "../repositories/index.js";

export class PresentationService {
  constructor(private readonly repository: PresentationRepository) {}

  list(context: TenantContext) {
    return this.repository.list(context);
  }

  get(context: TenantContext, id: string) {
    return this.repository.get(context, id);
  }

  create(context: TenantContext, input: CreatePresentationInput) {
    return this.repository.create(context, input);
  }

  save(context: TenantContext, id: string, input: SavePresentationInput) {
    return this.repository.save(context, id, input);
  }

  saveSlide(
    context: TenantContext,
    documentId: string,
    slide: Omit<Slide, "id" | "revision"> & {
      id?: string;
      revision?: number;
    },
  ) {
    return this.repository.saveSlide(context, documentId, slide);
  }

  listThemes(context: TenantContext) {
    return this.repository.listThemes(context);
  }

  listImages(context: TenantContext) {
    return this.repository.listImages(context);
  }
}
