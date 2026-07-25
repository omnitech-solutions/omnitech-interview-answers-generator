"use client";
/* c8 ignore file -- browser/WebSocket behavior is verified in the running app. */

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { type JSX, useEffect, useRef } from "react";

const gatewayUrl =
  process.env["NEXT_PUBLIC_TERMINAL_GATEWAY_URL"] ??
  "ws://localhost:3001/terminal";

export function BrowserTerminal(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      scrollback: 1_000,
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
    const socket = new WebSocket(gatewayUrl);
    const fitVisibleTerminal = () => {
      const { height, width } = container.getBoundingClientRect();
      if (width < 40 || height < 40) return false;
      fitAddon.fit();
      return true;
    };

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitVisibleTerminal();
    terminal.writeln("Connecting to terminal gateway…");

    socket.addEventListener("open", () => {
      terminal.writeln("Connected to tmux session: workspace");
      if (fitVisibleTerminal()) {
        socket.send(
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
      terminal.writeln("\r\nTerminal gateway disconnected.");
    });
    socket.addEventListener("error", () => {
      terminal.writeln("\r\nUnable to connect to terminal gateway.");
    });

    const inputSubscription = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });
    const resizeObserver = new ResizeObserver(() => {
      if (fitVisibleTerminal() && socket.readyState === WebSocket.OPEN) {
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
      resizeObserver.disconnect();
      inputSubscription.dispose();
      socket.close();
      terminal.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="browser-terminal"
      aria-label="Terminal emulator"
    />
  );
}
