"use client";
/* c8 ignore file -- browser/WebSocket behavior is verified in the running app. */

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { type JSX, useEffect, useRef } from "react";

const gatewayUrl =
  process.env["NEXT_PUBLIC_TERMINAL_GATEWAY_URL"] ??
  "ws://localhost:3001/terminal";

export function BrowserTerminal({
  onCopyReady,
  sessionName = "workspace",
}: {
  onCopyReady?: (copy: (() => Promise<void>) | null) => void;
  sessionName?: string;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      scrollback: 10_000,
      scrollOnUserInput: true,
      smoothScrollDuration: 80,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      theme: {
        background: "#111827",
        foreground: "#e5e7eb",
        cursor: "#86efac",
        selectionBackground: "#374151",
      },
    });
    const fitAddon = new FitAddon();
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let disposed = false;
    const fitVisibleTerminal = () => {
      const { height, width } = container.getBoundingClientRect();
      if (width < 40 || height < 40) return false;
      fitAddon.fit();
      return true;
    };

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    onCopyReady?.(async () => {
      const buffer = terminal.buffer.active;
      const contents = Array.from({ length: buffer.length }, (_, index) =>
        buffer.getLine(index)?.translateToString(true),
      )
        .filter((line): line is string => line !== undefined)
        .join("\n")
        .trimEnd();
      await navigator.clipboard.writeText(contents);
    });
    const preventPageScroll = (event: WheelEvent) => {
      event.stopPropagation();
    };
    container.addEventListener("wheel", preventPageScroll, { passive: true });
    fitVisibleTerminal();

    function connect() {
      if (disposed) return;
      terminal.writeln("Connecting to terminal gateway…");
      const url = new URL(gatewayUrl);
      url.searchParams.set("session", sessionName);
      socket = new WebSocket(url.toString());
      socket.addEventListener("open", () => {
        terminal.writeln(`Connected to tmux session: ${sessionName}`);
        if (fitVisibleTerminal()) {
          socket?.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            }),
          );
        }
      });
      socket.addEventListener("message", (event: MessageEvent<string>) => {
        terminal.write(event.data);
      });
      socket.addEventListener("close", () => {
        if (disposed) return;
        terminal.writeln("\r\nTerminal gateway unavailable. Retrying…");
        reconnectTimer = window.setTimeout(connect, 1_000);
      });
    }
    connect();

    const inputSubscription = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });
    const resizeObserver = new ResizeObserver(() => {
      if (fitVisibleTerminal() && socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
      }
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      resizeObserver.disconnect();
      inputSubscription.dispose();
      container.removeEventListener("wheel", preventPageScroll);
      socket?.close();
      onCopyReady?.(null);
      terminal.dispose();
    };
  }, [onCopyReady, sessionName]);

  return (
    <div
      ref={containerRef}
      className="browser-terminal"
      aria-label="Terminal emulator"
    />
  );
}
