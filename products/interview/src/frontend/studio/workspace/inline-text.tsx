import { Fragment } from "react";

// Guide text is short and may use **bold** and `code`; nothing else.
const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`)/g;

export function InlineText({ children }: { children: string }) {
  return (
    <>
      {children.split(TOKEN).map((part, index) => {
        const key = `${index}:${part}`;
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
          return <strong key={key}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
          return <code key={key}>{part.slice(1, -1)}</code>;
        return <Fragment key={key}>{part}</Fragment>;
      })}
    </>
  );
}
