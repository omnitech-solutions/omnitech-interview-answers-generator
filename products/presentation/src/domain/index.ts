export interface TenantContext {
  tenantId: string;
  userId: string;
}

export interface PresentationSummary {
  id: string;
  title: string;
  revision: number;
  slideCount: number;
  favorite: boolean;
  updatedAt: string;
}

export interface Slide {
  id: string;
  position: number;
  sourceXml: string;
  content: Readonly<Record<string, unknown>>;
  revision: number;
}

export interface PresentationDocument extends PresentationSummary {
  outline: readonly string[];
  themeId: string | null;
  settings: Readonly<Record<string, unknown>>;
  slides: readonly Slide[];
}

export interface PresentationTheme {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  definition: Readonly<Record<string, unknown>>;
  favorite: boolean;
  liked: boolean;
}

export interface GeneratedImage {
  id: string;
  assetReference: string;
  providerId: string;
  modelId: string;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
}

export interface PresentationRecording {
  id: string;
  assetReference: string;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
}

export interface PresentationShare {
  id: string;
  token: string;
}

export interface CreatePresentationInput {
  title: string;
  outline?: readonly string[];
  themeId?: string;
  settings?: Readonly<Record<string, unknown>>;
  idempotencyKey: string;
}

export interface SavePresentationInput {
  title?: string;
  outline?: readonly string[];
  themeId?: string | null;
  settings?: Readonly<Record<string, unknown>>;
  expectedRevision: number;
}

/** The document is missing, deleted, or belongs to another tenant. */
export class PresentationNotFoundError extends Error {
  constructor() {
    super("Presentation not found.");
    this.name = "PresentationNotFoundError";
  }
}

/** The theme is missing or belongs to another tenant. */
export class PresentationThemeNotFoundError extends Error {
  constructor() {
    super("Theme not found.");
    this.name = "PresentationThemeNotFoundError";
  }
}

export class PresentationConflictError extends Error {
  constructor() {
    super("The presentation changed since it was loaded.");
    this.name = "PresentationConflictError";
  }
}
