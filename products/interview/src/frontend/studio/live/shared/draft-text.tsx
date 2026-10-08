// A drafted answer is Markdown point form the model wrote: bullets and
// **bold** key terms. This renders exactly that and nothing else: no HTML, no
// links, no images, no headings, no code, so model text can never become
// markup or a request (rule:captured-input-untrusted). Everything it does not
// recognise stays literal text.
import type { ReactNode } from "react";

const BOLD = /\*\*([^*\n]+)\*\*/g;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;

// Text with **term** shown as strong; an unbalanced marker stays as written.
export function InlineBold({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let from = 0;
  for (const match of text.matchAll(BOLD)) {
    if (match.index > from) parts.push(text.slice(from, match.index));
    parts.push(<strong key={match.index}>{match[1]}</strong>);
    from = match.index + match[0].length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

type Block = { kind: "list"; items: string[] } | { kind: "text"; text: string };

// Consecutive bullet lines form one list; other lines form paragraphs split on
// blank lines.
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length > 0)
      blocks.push({ kind: "text", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const line of text.split("\n")) {
    const bullet = BULLET.exec(line);
    if (bullet) {
      endParagraph();
      const last = blocks.at(-1);
      if (last?.kind === "list") last.items.push(bullet[1] ?? "");
      else blocks.push({ kind: "list", items: [bullet[1] ?? ""] });
    } else if (line.trim() === "") endParagraph();
    else paragraph.push(line);
  }
  endParagraph();
  return blocks;
}

export function DraftPoints({ text }: { text: string }) {
  return (
    <>
      {blocksOf(text).map((block, index) =>
        block.kind === "list" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are split from one string with no id and the list is replaced whole, never reordered
          <ul key={index} className="live-draft-points">
            {block.items.map((item, at) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the items carry no id and repeat, and the list is rebuilt whole from its source in a fixed order, never reordered
              <li key={at} className="live-draft-text">
                <InlineBold text={item} />
              </li>
            ))}
          </ul>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the items carry no id and repeat, and the list is rebuilt whole from its source in a fixed order, never reordered
          <p key={index} className="live-draft-text">
            <InlineBold text={block.text} />
          </p>
        ),
      )}
    </>
  );
}

// What Copy puts on the clipboard: the points without the bold markers.
export const plainDraft = (text: string): string => text.replace(BOLD, "$1");
