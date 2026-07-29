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

  delete(context: TenantContext, id: string) {
    return this.repository.softDelete(context, id);
  }

  duplicate(context: TenantContext, id: string) {
    return this.repository.duplicate(context, id);
  }

  setFavorite(context: TenantContext, id: string, favorite: boolean) {
    return this.repository.setFavorite(context, id, favorite);
  }

  createTheme(
    context: TenantContext,
    input: {
      name: string;
      description: string;
      definition: Readonly<Record<string, unknown>>;
    },
  ) {
    return this.repository.createTheme(context, input);
  }

  setThemeReaction(
    context: TenantContext,
    themeId: string,
    reaction: "favorite" | "like",
    enabled: boolean,
  ) {
    return this.repository.setThemeReaction(
      context,
      themeId,
      reaction,
      enabled,
    );
  }

  createShare(context: TenantContext, documentId: string) {
    return this.repository.createShare(context, documentId);
  }

  revokeShare(context: TenantContext, shareId: string) {
    return this.repository.revokeShare(context, shareId);
  }

  requestExport(
    context: TenantContext,
    documentId: string,
    format: "pptx" | "pdf",
    idempotencyKey: string,
  ) {
    return this.repository.requestExport(
      context,
      documentId,
      format,
      idempotencyKey,
    );
  }

  saveRecording(
    context: TenantContext,
    documentId: string,
    assetReference: string,
    metadata: Readonly<Record<string, unknown>>,
  ) {
    return this.repository.saveRecording(
      context,
      documentId,
      assetReference,
      metadata,
    );
  }
}
