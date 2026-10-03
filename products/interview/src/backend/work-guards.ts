// Guards for work that is slow, costs money, and is watched by a person who
// may leave. They know nothing about documents: each takes plain values, so
// the same few lines serve any long-running request.

/** Work that is running, by key, so a second asker is told rather than charged. */
export function createInFlight() {
  const running = new Set<string>();
  return {
    /** A release function when the key is free; null when it is running now. */
    claim(key: string): (() => void) | null {
      if (running.has(key)) return null;
      running.add(key);
      return () => void running.delete(key);
    },
  };
}

/**
 * A signal that ends with the request, and also when the reader of a stream
 * goes away (a reload, a closed tab), which a request signal does not always
 * report.
 */
export function linkedAbort(request: AbortSignal) {
  const reader = new AbortController();
  return {
    signal: AbortSignal.any([request, reader.signal]),
    readerGone: () => reader.abort(),
  };
}

/**
 * Newline-delimited JSON events: `run` sends them as work progresses, the
 * stream closes when it ends, and `onReaderGone` fires if the reader leaves.
 * Nothing is sent to a reader that has gone.
 */
export function ndjsonResponse<Event extends object>(
  run: (send: (event: Event) => void) => Promise<void>,
  options: { onReaderGone(): void; onSettled?(): void },
): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      cancel: options.onReaderGone,
      async start(controller) {
        const send = (event: Event) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // The reader went away; the abort signal stops the work.
          }
        };
        try {
          await run(send);
        } finally {
          options.onSettled?.();
          try {
            controller.close();
          } catch {
            // Already closed by the reader.
          }
        }
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
