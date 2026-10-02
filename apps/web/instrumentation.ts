// Next.js calls register() once when the server starts. In the Node.js
// runtime it runs Interview Studio's assistant turns in the background.
export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs")
    await import("./instrumentation-node");
}
