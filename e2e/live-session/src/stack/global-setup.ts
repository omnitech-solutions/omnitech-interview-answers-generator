import { startStack } from "./stack";

// Playwright's global setup: starts the stack once and returns its teardown.
export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await startStack();
  return () => stack.stop();
}
