function line(value: string): string {
  return `${value.replaceAll("\n", "\r\n")}\r\n`;
}

export function renderEvent(event: unknown): string {
  if (!event || typeof event !== "object" || !("type" in event)) {
    return line("[event] Progress update");
  }
  const value = event as Record<string, unknown>;
  if (value["type"] === "text-delta" && typeof value["text"] === "string") {
    return value["text"].replaceAll("\n", "\r\n");
  }
  if (value["type"] === "started") {
    return line(`[started] Session ${String(value["sessionId"] ?? "")}`);
  }
  if (value["type"] === "tool-started") {
    return line(`[tool] ${String(value["tool"] ?? "unknown")} started`);
  }
  if (value["type"] === "tool-finished") {
    return line(
      `[tool] ${String(value["tool"] ?? "unknown")} ${
        value["success"] ? "finished" : "failed"
      }`,
    );
  }
  if (value["type"] === "usage") return line("[usage] Updated");
  if (value["type"] === "completed") return line("\n[completed] Job finished");
  if (value["type"] === "failed") {
    const error =
      value["error"] && typeof value["error"] === "object"
        ? (value["error"] as Record<string, unknown>)["message"]
        : "Job failed";
    return line(`\n[failed] ${String(error)}`);
  }
  return line(`[${String(value["type"])}]`);
}
