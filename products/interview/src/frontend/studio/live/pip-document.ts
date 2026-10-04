// Document Picture-in-Picture helpers: the API handle, and copying the page's
// styles into the new document so the float looks like Studio.

type PipApi = {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
};

// null when the browser has no Document Picture-in-Picture.
export function pipApi(): PipApi | null {
  const api = (window as unknown as { documentPictureInPicture?: PipApi })
    .documentPictureInPicture;
  return api && typeof api.requestWindow === "function" ? api : null;
}

export function copyStyles(from: Document, to: Document): void {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const style = to.createElement("style");
      style.textContent = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      to.head.append(style);
    } catch {
      // A cross-origin sheet cannot be read: link it instead.
      if (!sheet.href) continue;
      const link = to.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      to.head.append(link);
    }
  }
  // Theme tokens hang off the root element.
  to.documentElement.className = from.documentElement.className;
  const theme = from.documentElement.getAttribute("data-theme");
  if (theme) to.documentElement.setAttribute("data-theme", theme);
}

// A watched document's visibility, for the store's one polling loop.
export function documentVisibility(doc: Document) {
  return {
    isVisible: () => doc.visibilityState !== "hidden",
    onChange(listener: () => void) {
      doc.addEventListener("visibilitychange", listener);
      return () => doc.removeEventListener("visibilitychange", listener);
    },
  };
}
