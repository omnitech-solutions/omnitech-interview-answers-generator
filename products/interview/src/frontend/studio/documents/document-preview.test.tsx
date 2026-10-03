import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentPreview } from "./document-preview";

const renderAsync = vi.fn(
  async (_data: ArrayBuffer, host: HTMLElement, styles?: HTMLElement) => {
    if (styles)
      styles.innerHTML =
        '<style>p.docx-num-1-0:before { content: "\uf0b7\\9"; counter-increment: n; font-family: Symbol; }\np.docx-num-2-0:before { content: "o\\9"; font-family: Arial; }</style>';
    host.innerHTML =
      '<section class="docx"><p>Hi full_nameAda, email_address portfolio</p></section>';
  },
);
vi.mock("docx-preview", () => ({
  renderAsync: (data: ArrayBuffer, host: HTMLElement, styles?: HTMLElement) =>
    renderAsync(data, host, styles),
}));

const fields = [
  {
    key: "full_name",
    label: "Full name",
    source: "candidate-profile",
    required: true,
    maxLength: null,
  },
  {
    key: "email_address",
    label: "Email address",
    source: "candidate-profile",
    required: true,
    maxLength: null,
  },
  {
    key: "portfolio",
    label: "Portfolio",
    source: "candidate-profile",
    required: false,
    maxLength: null,
  },
] as const;

async function frameFor(ui: React.ReactElement) {
  render(ui);
  const frame = screen.getByTitle("Document preview") as HTMLIFrameElement;
  fireEvent.load(frame);
  return frame;
}

describe("DocumentPreview", () => {
  it("runs nothing inside the frame and offers no network", () => {
    render(
      <DocumentPreview
        preview={null}
        fields={fields}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    const frame = screen.getByTitle("Document preview");
    expect(frame).toHaveAttribute("sandbox", "allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
  });

  it("marks an empty required field as missing, hides an optional one, and lights the selected one", async () => {
    const frame = await frameFor(
      <DocumentPreview
        preview={{
          kind: "html",
          html: '<p><span class="doc-field" data-field="full_name">Ada</span> <span class="doc-field doc-empty" data-field="email_address"></span> <span class="doc-field doc-empty" data-field="portfolio"></span></p>',
        }}
        fields={fields}
        selected="full_name"
        onSelect={vi.fn()}
      />,
    );
    const body = () => frame.contentDocument!.body;
    await waitFor(() =>
      expect(body().querySelector('[data-field="email_address"]')).toHaveClass(
        "doc-missing",
      ),
    );
    expect(
      body().querySelector('[data-field="email_address"]')?.textContent,
    ).toBe("Email address");
    expect(body().querySelector('[data-field="portfolio"]')).not.toHaveClass(
      "doc-missing",
    );
    await waitFor(() =>
      expect(body().querySelector('[data-field="full_name"]')).toHaveAttribute(
        "data-selected",
      ),
    );
  });

  it("shows a gap as coming, not missing, while the document is being written, and flashes what lands", async () => {
    const html = (name: string) => ({
      kind: "html" as const,
      html: `<p><span class="doc-field${name ? "" : " doc-empty"}" data-field="full_name">${name}</span> <span class="doc-field doc-empty" data-field="email_address"></span></p>`,
    });
    const { rerender } = render(
      <DocumentPreview
        preview={html("")}
        fields={fields}
        selected={null}
        onSelect={vi.fn()}
        writing
      />,
    );
    const frame = screen.getByTitle("Document preview") as HTMLIFrameElement;
    fireEvent.load(frame);
    const get = (key: string) =>
      frame.contentDocument!.querySelector(`[data-field="${key}"]`);
    await waitFor(() => expect(get("full_name")).toHaveClass("doc-pending"));
    expect(get("email_address")).toHaveClass("doc-pending");
    expect(get("email_address")).not.toHaveClass("doc-missing");
    rerender(
      <DocumentPreview
        preview={html("Ada")}
        fields={fields}
        selected={null}
        onSelect={vi.fn()}
        writing
      />,
    );
    await waitFor(() => expect(get("full_name")).toHaveClass("doc-fresh"));
    expect(get("full_name")).not.toHaveClass("doc-pending");
    expect(get("full_name")?.textContent).toBe("Ada");
  });

  it("selects a field when its text is clicked", async () => {
    const onSelect = vi.fn();
    const frame = await frameFor(
      <DocumentPreview
        preview={{
          kind: "html",
          html: '<p><span class="doc-field" data-field="full_name">Ada</span></p>',
        }}
        fields={fields}
        selected={null}
        onSelect={onSelect}
      />,
    );
    await waitFor(() =>
      expect(
        frame.contentDocument!.querySelector('[data-field="full_name"]'),
      ).not.toBeNull(),
    );
    fireEvent.click(
      frame.contentDocument!.querySelector('[data-field="full_name"]')!,
    );
    expect(onSelect).toHaveBeenCalledWith("full_name");
  });

  it("draws a DOCX with the document's own renderer and restores its tagged values", async () => {
    const frame = await frameFor(
      <DocumentPreview
        preview={{ kind: "docx", docx: btoa("PK-not-a-real-docx") }}
        fields={fields}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        frame.contentDocument!.querySelector('[data-field="full_name"]')
          ?.textContent,
      ).toBe("Ada"),
    );
    expect(renderAsync).toHaveBeenCalledOnce();
    expect(frame.contentDocument!.body.textContent).not.toMatch(/[-]/);
    expect(
      frame.contentDocument!.querySelector('[data-field="email_address"]'),
    ).toHaveClass("doc-missing");
  });

  it("draws Word's Symbol-font bullets as real bullets and leaves other markers alone", async () => {
    const frame = await frameFor(
      <DocumentPreview
        preview={{ kind: "docx", docx: btoa("x") }}
        fields={fields}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(frame.contentDocument!.querySelector("style")).not.toBeNull(),
    );
    const css = [...frame.contentDocument!.querySelectorAll("style")]
      .map((style) => style.textContent)
      .join("\n");
    expect(css).toContain('content: "\u2022\\9"');
    expect(css).not.toMatch(/Symbol/);
    expect(css).not.toMatch(/\uf0b7/);
    expect(css).toContain('content: "o\\9"');
  });

  it("says so, without losing the fields, when the document cannot be drawn", async () => {
    renderAsync.mockRejectedValueOnce(new Error("corrupt"));
    await frameFor(
      <DocumentPreview
        preview={{ kind: "docx", docx: btoa("x") }}
        fields={fields}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be drawn",
    );
  });
});
