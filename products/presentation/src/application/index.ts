import type {
  CreatePresentationInput,
  SavePresentationInput,
  Slide,
  TenantContext,
} from "../domain/index";
import { PresentationNotFoundError } from "../domain/index";
import { exportPresentation } from "../export/index";
import type { PresentationRepository } from "../repositories/index";

export class PresentationService {
  constructor(private readonly repository: PresentationRepository) {}

  list(context: TenantContext) {
    return this.repository.list(context);
  }

  get(context: TenantContext, id: string) {
    return this.repository.get(context, id);
  }

  getShared(token: string) {
    return this.repository.getShared(token);
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

  deleteSlide(context: TenantContext, documentId: string, slideId: string) {
    return this.repository.deleteSlide(context, documentId, slideId);
  }

  moveSlide(
    context: TenantContext,
    documentId: string,
    slideId: string,
    position: number,
  ) {
    return this.repository.moveSlide(context, documentId, slideId, position);
  }

  listThemes(context: TenantContext) {
    return this.repository.listThemes(context);
  }

  listImages(context: TenantContext) {
    return this.repository.listImages(context);
  }

  recordGeneratedImage(
    context: TenantContext,
    input: {
      assetReference: string;
      promptReference: string;
      providerId: string;
      modelId: string;
      metadata: Readonly<Record<string, unknown>>;
    },
  ) {
    return this.repository.recordGeneratedImage(context, input);
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

  importTheme(
    context: TenantContext,
    input: {
      name: string;
      description: string;
      definition: Readonly<Record<string, unknown>>;
      sourceImportId?: string;
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

  async export(
    context: TenantContext,
    documentId: string,
    format: "pptx" | "pdf",
    idempotencyKey: string,
  ) {
    const exportId = await this.repository.requestExport(
      context,
      documentId,
      format,
      idempotencyKey,
    );
    const document = await this.repository.get(context, documentId);
    if (!document) throw new PresentationNotFoundError();
    const assetReference = await exportPresentation(document, format);
    await this.repository.completeExport(context, exportId, assetReference);
    return { id: exportId, assetReference };
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

  listRecordings(context: TenantContext, documentId: string) {
    return this.repository.listRecordings(context, documentId);
  }
}
