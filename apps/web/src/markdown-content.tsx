"use client";

import React, {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { PanzoomObject } from "@panzoom/panzoom";
import ReactMarkdown, { type Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
import remarkGfm from "remark-gfm";

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const diagramId = `mermaid-${reactId.replaceAll(":", "")}`;
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const diagramRef = useRef<HTMLDivElement>(null);
  const panzoomRef = useRef<PanzoomObject | null>(null);

  useEffect(() => {
    let active = true;

    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        const dark = document.documentElement.dataset["theme"] === "dark";
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
        });
        const rendered = await mermaid.render(diagramId, source);
        if (!active) return;
        setSvg(rendered.svg);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setSvg("");
        setError(
          reason instanceof Error
            ? reason.message
            : "The Mermaid diagram could not be rendered.",
        );
      });

    return () => {
      active = false;
    };
  }, [diagramId, source]);

  useEffect(() => {
    const diagram = diagramRef.current;
    if (!diagram || !svg) return;
    let active = true;
    let removeWheelListener = () => undefined;

    void import("@panzoom/panzoom").then(({ default: Panzoom }) => {
      if (!active) return;
      const instance = Panzoom(diagram, {
        animate: true,
        canvas: true,
        contain: "inside",
        cursor: "grab",
        maxScale: 6,
        minScale: 0.5,
        startScale: 1,
        startX: 0,
        startY: 0,
        step: 0.25,
      });
      panzoomRef.current = instance;
      const canvas = diagram.parentElement;
      const onWheel = (event: WheelEvent) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        instance.zoomWithWheel(event);
      };
      canvas?.addEventListener("wheel", onWheel, { passive: false });
      removeWheelListener = () => {
        canvas?.removeEventListener("wheel", onWheel);
      };
    });

    return () => {
      active = false;
      removeWheelListener();
      panzoomRef.current?.destroy();
      panzoomRef.current = null;
    };
  }, [svg]);

  async function copySource() {
    await navigator.clipboard.writeText(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  async function toggleFullscreen() {
    const container = diagramRef.current?.closest(".mermaid-diagram");
    if (!(container instanceof HTMLElement)) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await container.requestFullscreen();
    }
  }

  if (error) {
    return (
      <figure className="mermaid-diagram mermaid-error">
        <figcaption>Diagram source</figcaption>
        <p role="alert">Mermaid could not render this diagram: {error}</p>
        <pre>
          <code>{source}</code>
        </pre>
      </figure>
    );
  }

  if (!svg) {
    return (
      <div className="mermaid-diagram mermaid-loading" role="status">
        Rendering diagram…
      </div>
    );
  }

  return (
    <figure
      className={`mermaid-diagram${showSource ? " mermaid-diagram-split" : ""}`}
      aria-label="Workflow diagram"
    >
      <div
        className="mermaid-canvas"
        aria-label="Interactive diagram. Drag to pan; pinch or hold Control or Command while scrolling to zoom."
      >
        <div
          className="mermaid-toolbar panzoom-exclude"
          aria-label="Diagram controls"
          onPointerDownCapture={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => panzoomRef.current?.zoomOut()}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M3 8h10" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => panzoomRef.current?.zoomIn()}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Reset diagram view"
            title="Reset view"
            onClick={() => panzoomRef.current?.reset({ animate: false })}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M13 5V2m0 0h-3m3 0-2.1 2.1a5 5 0 1 0 1.2 5.2" />
            </svg>
          </button>
          <span className="mermaid-toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            aria-label={showSource ? "Hide syntax" : "Show syntax"}
            aria-pressed={showSource}
            title={showSource ? "Hide syntax" : "Show syntax"}
            onClick={() => setShowSource((open) => !open)}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="m6 3-4 5 4 5M10 3l4 5-4 5" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={copied ? "Syntax copied" : "Copy syntax"}
            title={copied ? "Copied" : "Copy syntax"}
            onClick={() => void copySource()}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              {copied ? (
                <path d="m3 8 3 3 7-7" />
              ) : (
                <>
                  <rect x="5" y="5" width="8" height="8" rx="1" />
                  <path d="M3 11H2V3a1 1 0 0 1 1-1h8v1" />
                </>
              )}
            </svg>
          </button>
          <button
            type="button"
            aria-label="Toggle diagram fullscreen"
            title="Fullscreen"
            onClick={() => void toggleFullscreen()}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" />
            </svg>
          </button>
        </div>
        <div
          ref={diagramRef}
          className="mermaid-panzoom"
          // Mermaid creates the SVG from the fenced source with strict security.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {showSource ? (
        <SyntaxHighlighter
          className="mermaid-source"
          language="mermaid"
          showLineNumbers
          style={
            document.documentElement.dataset["theme"] === "dark"
              ? oneDark
              : oneLight
          }
          wrapLongLines
        >
          {source}
        </SyntaxHighlighter>
      ) : null}
    </figure>
  );
}

function MarkdownCode({
  children,
  className,
  ...props
}: ComponentProps<"code">) {
  const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
  if (language === "mermaid") {
    return <MermaidDiagram source={String(children).replace(/\n$/, "")} />;
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

function MarkdownPre({
  children,
  ...props
}: ComponentProps<"pre"> & { children?: ReactNode }) {
  const child = children as ReactElement<{ className?: string }> | undefined;
  if (
    React.isValidElement(child) &&
    child.props.className?.includes("language-mermaid")
  ) {
    return children;
  }
  return <pre {...props}>{children}</pre>;
}

const components: Components = {
  code: MarkdownCode,
  pre: MarkdownPre,
};

export function MarkdownContent({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
