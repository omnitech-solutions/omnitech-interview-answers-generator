"use client";

// [SAFETY] Replaces the root layout when a render error escapes every other
// boundary. The message is fixed: an error's text or digest can quote a prompt,
// a note or a credential (AGENTS rule 8), and the digest is only useful with
// server logs this app does not write. It imports no stylesheet so it still
// renders when the failure was in the app's own CSS or fonts.
export default function GlobalError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0e1015",
          color: "#e8eaf0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0 0 16px", opacity: 0.75 }}>
            Studio hit an unexpected problem. Your work on the server is not
            affected.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              font: "inherit",
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #3a3f4d",
              background: "#1a1d26",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
