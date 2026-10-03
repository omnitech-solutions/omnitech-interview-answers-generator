import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlideBlockEditor, SlideBlockView } from "./slide-blocks.js";

afterEach(cleanup);

const section = (body: string) =>
  `<SECTION layout="vertical">${body}</SECTION>`;

describe("slide block view", () => {
  it("renders text blocks with inline formatting", () => {
    const { container } = render(
      <SlideBlockView
        source={section(
          "<TITLE>Deck</TITLE><H1>One **bold** and *soft*</H1><H2>Two</H2><H3>Three</H3><P>Use `code` here</P><QUOTE>Be brief</QUOTE>",
        )}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Deck");
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("soft").tagName).toBe("EM");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(container.querySelector("blockquote")).toHaveTextContent("Be brief");
  });

  it("renders code, bullets, columns and images", () => {
    const { container } = render(
      <SlideBlockView
        source={section(
          '<CODE>const a = 1;</CODE><BULLETS>First; Second\nThird</BULLETS><COLUMNS>Left | Right</COLUMNS><IMG url="https://img.test/a.png" />',
        )}
      />,
    );
    expect(container.querySelector("pre")).toHaveTextContent("const a = 1;");
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["First", "Second", "Third"]);
    expect(screen.getByText("Left | Right")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://img.test/a.png",
    );
  });

  it("draws chart, diagram and infographic data", () => {
    render(
      <SlideBlockView
        source={section(
          '<CHART>{"labels":["Q1","Q2"],"values":[10,"x",5]}</CHART><DIAGRAM>{"nodes":["In","Out"]}</DIAGRAM><INFOGRAPHIC>{"users":"42%"}</INFOGRAPHIC>',
        )}
      />,
    );
    const chart = screen.getByRole("img", { name: "Chart" });
    expect(chart.querySelectorAll("rect")).toHaveLength(3);
    expect(chart).toHaveTextContent("Q1");
    expect(chart).toHaveTextContent("Q2");
    expect(screen.getByLabelText("Diagram")).toHaveTextContent("In→Out");
    expect(screen.getByLabelText("Infographic")).toHaveTextContent("users42%");
  });

  it("falls back to the raw data when chart, diagram or infographic data is not JSON", () => {
    render(
      <SlideBlockView
        source={section(
          "<CHART>not json</CHART><DIAGRAM>[broken</DIAGRAM><INFOGRAPHIC>plain</INFOGRAPHIC>",
        )}
      />,
    );
    expect(screen.getByText("not json")).toBeInTheDocument();
    expect(screen.getByText("CHART")).toBeInTheDocument();
    expect(screen.getByText("DIAGRAM")).toBeInTheDocument();
    expect(screen.getByText("INFOGRAPHIC")).toBeInTheDocument();
  });

  it("tolerates chart and diagram data missing their arrays", () => {
    render(
      <SlideBlockView
        source={section("<CHART>{}</CHART><DIAGRAM>{}</DIAGRAM>")}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Chart" }).querySelectorAll("rect"),
    ).toHaveLength(0);
    expect(screen.getByLabelText("Diagram")).toBeEmptyDOMElement();
  });

  it("applies the theme appearance to the slide", () => {
    const { container } = render(
      <SlideBlockView
        appearance={{
          background: "#111827",
          text: "#f8fafc",
          textAlign: "center",
        }}
        source={section("<P>Hi</P>")}
      />,
    );
    const view = container.firstElementChild as HTMLElement;
    expect(view.style.color).toBe("rgb(248, 250, 252)");
    expect(view.style.textAlign).toBe("center");
    expect(view.style.getPropertyValue("--slide-font-size")).toBe("26px");
  });
});

describe("slide block editor", () => {
  function setup(source = section("<H1>Intro</H1><P>Body</P>")) {
    const onChange = vi.fn();
    render(<SlideBlockEditor onChange={onChange} source={source} />);
    return onChange;
  }

  it("changes a block type, removes a block and adds a paragraph", () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText("Block 1 type"), {
      target: { value: "H2" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      section("<H2>Intro</H2><P>Body</P>"),
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]!);
    expect(onChange).toHaveBeenLastCalledWith(section("<H2>Intro</H2>"));

    fireEvent.click(screen.getByRole("button", { name: "Add content block" }));
    expect(onChange).toHaveBeenLastCalledWith(
      section("<H2>Intro</H2><P>New paragraph</P>"),
    );
  });

  it("wraps the selection with bold and italic and refocuses the text", async () => {
    const onChange = setup(section("<P>make it pop</P>"));
    const area = screen.getByLabelText(
      "Rich text content",
    ) as HTMLTextAreaElement;
    area.setSelectionRange(8, 11);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onChange).toHaveBeenLastCalledWith(
      section("<P>make it **pop**</P>"),
    );
    await waitFor(() => expect(area).toHaveFocus());

    area.setSelectionRange(0, 4);
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    expect(onChange).toHaveBeenLastCalledWith(
      section("<P>*make* it **pop**</P>"),
    );
  });

  it("strips existing markers from a selection before wrapping it again", () => {
    const onChange = setup(section("<P>**pop**</P>"));
    const area = screen.getByLabelText(
      "Rich text content",
    ) as HTMLTextAreaElement;
    area.setSelectionRange(0, 7);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onChange).toHaveBeenLastCalledWith(section("<P>**pop**</P>"));

    area.setSelectionRange(0, 7);
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(onChange).toHaveBeenLastCalledWith(section("<P>`**pop**`</P>"));
  });

  it("gives code blocks a taller editor", () => {
    setup(section("<CODE>x</CODE><P>y</P>"));
    const [code, paragraph] = screen.getAllByLabelText("Rich text content");
    expect(code).toHaveAttribute("rows", "5");
    expect(paragraph).toHaveAttribute("rows", "2");
  });
});
