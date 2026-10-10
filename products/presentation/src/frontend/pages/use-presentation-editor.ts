"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import { useEffect, useMemo, useState } from "react";

import type {
  GeneratedImage,
  PresentationDocument,
  PresentationTheme,
  Slide,
} from "../../domain/index";
import { copyText } from "../copy-text";
import { createPresentationClient } from "../presentation-client";
import { AI_PROFILE_KEY, localStore } from "../presentation-settings";
import type { SlideBlock, SlideBlockType } from "../slide-blocks";
import { parseSlideBlocks, serializeSlideBlocks } from "../slide-blocks";

function slideSourceCandidate(value: unknown): string | undefined {
  if (typeof value === "string" && value.includes("<SECTION")) return value;
  if (typeof value !== "object" || value === null) return undefined;
  const sourceXml = (value as { sourceXml?: unknown }).sourceXml;
  return typeof sourceXml === "string" && sourceXml.includes("<SECTION")
    ? sourceXml
    : undefined;
}

function defaultSlide(position: number): Slide {
  return {
    id: crypto.randomUUID(),
    position,
    sourceXml:
      '<SECTION layout="vertical"><H1>New slide</H1><P>Add your content</P></SECTION>',
    content: {},
    revision: 1,
  };
}

export function usePresentationEditor({
  tenantSlug,
  pathSegments,
}: ProductPageProps) {
  const client = useMemo(
    () => createPresentationClient(tenantSlug),
    [tenantSlug],
  );
  const id = pathSegments[1];
  const [document, setDocument] = useState<PresentationDocument>();
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [slidePrompt, setSlidePrompt] = useState("");
  const [agentOutput, setAgentOutput] = useState("");
  const [agentCandidate, setAgentCandidate] = useState("");
  const [agentJobId, setAgentJobId] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareId, setShareId] = useState("");
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState("");
  const [themes, setThemes] = useState<PresentationTheme[]>([]);
  const [activePanel, setActivePanel] = useState<
    | "text"
    | "elements"
    | "charts"
    | "diagrams"
    | "embeds"
    | "setup"
    | "themes"
    | "record"
    | "ai"
    | null
  >(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelSearch, setPanelSearch] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [undoSources, setUndoSources] = useState<
    Array<{ id: string; source: string }>
  >([]);
  const [redoSources, setRedoSources] = useState<
    Array<{ id: string; source: string }>
  >([]);
  const [dirtySlides, setDirtySlides] = useState<Set<string>>(new Set());
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirtySlides.size === 0) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtySlides]);
  const selected = useMemo(
    () => document?.slides.find((slide) => slide.id === selectedId),
    [document, selectedId],
  );
  useEffect(() => {
    if (!id) return;
    return client.loadDocument(
      id,
      (value) => {
        setDocument(value);
        setSelectedId(value.slides[0]?.id ?? "");
      },
      (reason) =>
        setStatus(reason instanceof Error ? reason.message : "Unable to load."),
    );
  }, [id, client]);
  useEffect(() => client.loadImages(setImages), [client]);
  useEffect(() => client.loadThemes(setThemes), [client]);
  async function saveDocument(next: PresentationDocument) {
    setStatus("Saving…");
    try {
      const response = await client.saveDocument(next.id, {
        title: next.title,
        outline: next.outline,
        themeId: next.themeId,
        settings: next.settings,
        expectedRevision: next.revision,
      });
      setDocument({ ...next, revision: response.revision });
      setStatus("Saved.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Save failed.");
    }
  }
  async function saveSlide(slide: Slide) {
    if (!document) return;
    setStatus("Saving slide…");
    try {
      const response = await client.saveSlide(document.id, slide);
      setDocument({
        ...document,
        slides: document.slides.map((item) =>
          item.id === slide.id
            ? { ...slide, id: response.id, revision: response.revision }
            : item,
        ),
      });
      setDirtySlides((current) => {
        const next = new Set(current);
        next.delete(slide.id);
        return next;
      });
      setStatus("Saved.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Save failed.");
    }
  }
  async function deleteSlide(slide: Slide) {
    if (!document || document.slides.length <= 1) return;
    if (dirtySlides.has(slide.id)) {
      setStatus("Save slide changes before deleting.");
      return;
    }
    setStatus("Deleting slide…");
    try {
      await client.deleteSlide(document.id, slide.id);
      const slides = document.slides
        .filter((item) => item.id !== slide.id)
        .map((item, position) => ({ ...item, position }));
      const latest = await client.getDocument(document.id);
      setDocument({ ...document, revision: latest.revision, slides });
      setDirtySlides(
        (current) => new Set([...current].filter((id) => id !== slide.id)),
      );
      setSelectedId(slides[0]?.id ?? "");
      setStatus("Slide deleted.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Delete failed.");
    }
  }
  async function moveSlide(slide: Slide, position: number) {
    if (!document || position < 0 || position >= document.slides.length) return;
    if (dirtySlides.size > 0) {
      setStatus("Save slide changes before reordering.");
      return;
    }
    setStatus("Moving slide…");
    try {
      await client.moveSlide(document.id, slide.id, position);
      const slides = [...document.slides]
        .sort((left, right) => left.position - right.position)
        .filter((item) => item.id !== slide.id);
      slides.splice(position, 0, slide);
      const latest = await client.getDocument(document.id);
      setDocument({
        ...document,
        revision: latest.revision,
        slides: slides.map((item, index) => ({ ...item, position: index })),
      });
      setStatus("Slide moved.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Move failed.");
    }
  }
  async function runAgent() {
    if (!document || !selected || !agentPrompt.trim()) return;
    setStatus("Starting design agent…");
    try {
      const job = await client.startAgent({
        productId: "omnitech.presentation",
        profileId: "presentation-editor",
        prompt: [
          "Presentation id:",
          document.id,
          "Selected slide source:",
          selected.sourceXml,
          "Requested change:",
          agentPrompt,
        ].join("\n"),
      });
      setStatus(`Agent job ${job.status}. Follow progress in the terminal.`);
      setAgentJobId(job.id);
      void watchAgent(job.id);
      setAgentPrompt("");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Agent failed.");
    }
  }
  async function generateSlide() {
    if (!document || !slidePrompt.trim()) return;
    setStatus("Generating slide…");
    try {
      const generated = await client.generateSlide(document.id, {
        prompt: slidePrompt,
        profileId: localStore.get(AI_PROFILE_KEY) || "document-fast",
        position: document.slides.length,
      });
      if (!generated.result.sourceXml)
        throw new Error("Generated slide was empty.");
      const slide = {
        ...defaultSlide(generated.position),
        sourceXml: generated.result.sourceXml,
      };
      setDocument({ ...document, slides: [...document.slides, slide] });
      setDirtySlides((current) => new Set([...current, slide.id]));
      setSelectedId(slide.id);
      setSlidePrompt("");
      setStatus("Slide draft ready; save it to keep the changes.");
    } catch (reason) {
      setStatus(
        reason instanceof Error ? reason.message : "Slide generation failed.",
      );
    }
  }
  async function watchAgent(jobId: string) {
    let sequence = 0;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const events = await client.agentEvents(jobId, sequence);
        for (const persisted of events) {
          sequence = Math.max(sequence, persisted.sequence);
          const event = persisted.event;
          if (event.type === "text-delta") {
            setAgentOutput((current) => `${current}${event.text ?? ""}`);
          } else if (event.type === "awaiting-input") {
            setStatus("Agent is waiting for approval or more input.");
            return;
          } else if (event.type === "completed") {
            setStatus("Agent completed; review the staged result.");
            if (event.result?.output !== undefined) {
              const output = event.result.output;
              setAgentOutput(JSON.stringify(output, null, 2));
              setAgentCandidate(slideSourceCandidate(output) ?? "");
            }
            try {
              const job = await client.getAgent(jobId);
              const durableOutput =
                typeof job.result === "object" &&
                job.result !== null &&
                "output" in job.result
                  ? job.result.output
                  : job.result;
              if (durableOutput !== undefined) {
                setAgentOutput(JSON.stringify(durableOutput, null, 2));
                setAgentCandidate(slideSourceCandidate(durableOutput) ?? "");
              }
            } catch {
              // The completion event is still usable if the durable payload is unavailable.
            }
            return;
          } else if (event.type === "failed") {
            setStatus(event.error?.message ?? "Agent failed.");
            return;
          }
        }
      } catch (reason) {
        setStatus(
          reason instanceof Error ? reason.message : "Agent polling failed.",
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    setStatus(
      "Agent is still running; progress remains available in the terminal.",
    );
  }
  async function cancelAgent() {
    if (!agentJobId) return;
    try {
      await client.cancelAgent(agentJobId);
      setStatus("Agent cancellation requested.");
    } catch (reason) {
      setStatus(
        reason instanceof Error ? reason.message : "Cancellation failed.",
      );
    }
  }
  async function resumeAgent() {
    if (!agentJobId || !agentPrompt.trim()) return;
    try {
      await client.resumeAgent(agentJobId, agentPrompt);
      setStatus("Agent resume queued.");
      setAgentPrompt("");
      void watchAgent(agentJobId);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Resume failed.");
    }
  }
  async function createShare() {
    if (!document) return;
    setStatus("Creating share link…");
    try {
      const result = await client.createShare(document.id);
      setShareId(result.id);
      const url = `${window.location.origin}/share/presentation/${result.token}`;
      setShareUrl(url);
      setStatus(
        (await copyText(url))
          ? "Share link ready and copied."
          : "Share link ready.",
      );
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Share failed.");
    }
  }
  async function revokeShare() {
    if (!shareId) return;
    try {
      await client.revokeShare(shareId);
      setShareId("");
      setShareUrl("");
      setStatus("Share link revoked.");
    } catch (reason) {
      setStatus(
        reason instanceof Error ? reason.message : "Unable to revoke share.",
      );
    }
  }
  async function exportDocument(format: "pptx" | "pdf") {
    if (!document) return;
    if (dirtySlides.size > 0) {
      setStatus("Save your slide changes before exporting.");
      return;
    }
    setStatus(`Exporting ${format.toUpperCase()}…`);
    try {
      const result = await client.exportDocument(document.id, {
        format,
        idempotencyKey: crypto.randomUUID(),
      });
      const link = window.document.createElement("a");
      link.href = result.assetReference;
      link.download = `${document.title || "presentation"}.${format}`;
      link.click();
      setStatus(`${format.toUpperCase()} exported.`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Export failed.");
    }
  }
  function updateSelectedSource(sourceXml: string) {
    if (!document || !selected || sourceXml === selected.sourceXml) return;
    setUndoSources((current) => [
      ...current.slice(-99),
      { id: selected.id, source: selected.sourceXml },
    ]);
    setRedoSources([]);
    setDirtySlides((current) => new Set([...current, selected.id]));
    setStatus("Unsaved changes. Save slide to keep this edit.");
    setDocument({
      ...document,
      slides: document.slides.map((slide) =>
        slide.id === selected.id ? { ...slide, sourceXml } : slide,
      ),
    });
  }
  function restoreSource(direction: "undo" | "redo") {
    if (!document) return;
    const stack = direction === "undo" ? undoSources : redoSources;
    const entry = stack.at(-1);
    const slide = document.slides.find((item) => item.id === entry?.id);
    if (!entry || !slide) return;
    const inverse = { id: slide.id, source: slide.sourceXml };
    if (direction === "undo") {
      setUndoSources(stack.slice(0, -1));
      setRedoSources((current) => [...current, inverse]);
    } else {
      setRedoSources(stack.slice(0, -1));
      setUndoSources((current) => [...current, inverse]);
    }
    setDocument({
      ...document,
      slides: document.slides.map((item) =>
        item.id === entry.id ? { ...item, sourceXml: entry.source } : item,
      ),
    });
    setSelectedId(entry.id);
    setDirtySlides((current) => new Set([...current, entry.id]));
    setStatus("Unsaved changes. Save slide to keep this edit.");
  }
  function addReferenceBlock(type: SlideBlockType, text: string) {
    if (!selected) return;
    const blocks = parseSlideBlocks(selected.sourceXml);
    const sourceXml = serializeSlideBlocks(selected.sourceXml, [
      ...blocks,
      { type, text } satisfies SlideBlock,
    ]);
    updateSelectedSource(sourceXml);
    setStatus(`${type.toLowerCase()} added to slide. Save slide to publish.`);
  }
  function panelCards(panel: Exclude<typeof activePanel, null>) {
    const cards: Array<[string, SlideBlockType, string]> =
      panel === "text"
        ? [
            ["Title", "TITLE", "New title"],
            ["Heading 1", "H1", "New heading"],
            ["Heading 2", "H2", "New heading"],
            ["Heading 3", "H3", "New heading"],
            ["Text", "P", "Add supporting text"],
            ["Blockquote", "QUOTE", "A memorable quote"],
            ["Code block", "CODE", "const example = true;"],
            ["Call to action", "P", "Learn more"],
            ["Table of contents", "P", "1. Overview\n2. Next steps"],
          ]
        : panel === "elements"
          ? [
              [
                "Bullet Points",
                "BULLETS",
                "First point\nSecond point\nThird point",
              ],
              ["Timeline", "BULLETS", "Now\nNext\nLater"],
              ["Steps", "BULLETS", "1. Discover\n2. Design\n3. Deliver"],
              ["Large Quote", "QUOTE", "Make the complex feel simple."],
              ["Side Quote", "QUOTE", "A useful perspective"],
              ["Comparison", "COLUMNS", "Before | After"],
              ["Before / After", "COLUMNS", "Before | After"],
              ["Pros & Cons", "COLUMNS", "Pros | Cons"],
            ]
          : panel === "charts"
            ? [
                [
                  "Bar chart",
                  "CHART",
                  '{"labels":["Q1","Q2","Q3"],"values":[24,42,35]}',
                ],
              ]
            : panel === "diagrams"
              ? [
                  [
                    "Process flow",
                    "DIAGRAM",
                    '{"nodes":["Input","Process","Output"],"edges":[]}',
                  ],
                ]
              : [];

    return cards;
  }
  async function duplicatePresentation() {
    if (!document) return;

    try {
      const copy = await client.duplicateDocument(document.id);
      window.location.assign(
        `/t/${tenantSlug}/p/presentation/editor/${copy.id}`,
      );
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Duplicate failed.");
    }
  }

  function renameDocument(title: string) {
    if (!document) return;
    setDocument({ ...document, title: title });
  }

  function openCreate() {
    window.location.assign(`/t/${tenantSlug}/p/presentation/create`);
  }

  function focusTitle() {
    window.document
      .querySelector<HTMLInputElement>(".presentation-reference-editor-title")
      ?.focus();
  }

  function openSetup() {
    setActivePanel("setup");
    setMenuOpen(false);
  }

  function openThemes() {
    setActivePanel("themes");
    setMenuOpen(false);
  }

  function openLibrary() {
    window.location.assign(`/t/${tenantSlug}/p/presentation/library`);
  }

  function addSlide() {
    if (!document) return;

    const slide = defaultSlide(document.slides.length);
    setDocument({ ...document, slides: [...document.slides, slide] });
    setDirtySlides((current) => new Set([...current, slide.id]));
    setSelectedId(slide.id);
  }

  function selectImage(imageId: string) {
    setSelectedImageId(imageId);
    const image = images.find((item) => item.id === imageId);
    if (image) addReferenceBlock("IMG", image.assetReference);
  }

  function applyAgentCandidate() {
    updateSelectedSource(agentCandidate);
    setStatus("Staged agent result applied locally; save to publish.");
    setAgentCandidate("");
  }

  function saveFontSize(fontSize: string) {
    if (!document) return;
    void saveDocument({
      ...document,
      settings: {
        ...document.settings,
        fontSize: fontSize,
      },
    });
  }

  function saveTextAlign(textAlign: string) {
    if (!document) return;
    void saveDocument({
      ...document,
      settings: {
        ...document.settings,
        textAlign: textAlign,
      },
    });
  }

  function selectTheme(theme: PresentationTheme) {
    if (!document) return;
    void saveDocument({
      ...document,
      themeId: theme.id,
      settings: {
        ...document.settings,
        themeDefinition: theme.definition,
      },
    });
  }

  function zoomOut() {
    setZoom((value) => Math.max(50, value - 10));
  }

  function zoomIn() {
    setZoom((value) => Math.min(150, value + 10));
  }

  function exportPptx() {
    setExportOpen(false);
    void exportDocument("pptx");
  }

  function exportPdf() {
    setExportOpen(false);
    void exportDocument("pdf");
  }

  return {
    id,
    document,
    selectedId,
    setSelectedId,
    status,
    agentPrompt,
    setAgentPrompt,
    slidePrompt,
    setSlidePrompt,
    agentOutput,
    agentCandidate,
    agentJobId,
    shareUrl,
    shareId,
    images,
    selectedImageId,
    themes,
    activePanel,
    setActivePanel,
    menuOpen,
    setMenuOpen,
    panelSearch,
    setPanelSearch,
    exportOpen,
    setExportOpen,
    zoom,
    undoSources,
    redoSources,
    selected,
    saveDocument,
    saveSlide,
    deleteSlide,
    moveSlide,
    runAgent,
    generateSlide,
    cancelAgent,
    resumeAgent,
    createShare,
    revokeShare,
    updateSelectedSource,
    restoreSource,
    addReferenceBlock,
    panelCards,
    duplicatePresentation,
    renameDocument,
    openCreate,
    focusTitle,
    openSetup,
    openThemes,
    openLibrary,
    addSlide,
    selectImage,
    applyAgentCandidate,
    saveFontSize,
    saveTextAlign,
    selectTheme,
    zoomOut,
    zoomIn,
    exportPptx,
    exportPdf,
  };
}
