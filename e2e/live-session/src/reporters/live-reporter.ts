// Prints a wall-clock line when each test STARTS and when it ENDS, with the
// project, `file:line` and title, so a screen recording can be matched to the
// exact test that was running (for example to find which one raised an OS
// dialog). Enable with E2E_LIVE=1; the list reporter stays on beside it.
import type {
  FullConfig,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

const clock = () => new Date().toTimeString().slice(0, 8);

function label(test: TestCase): string {
  const project = test.parent.project()?.name ?? "?";
  const where = `${test.location.file.split("/tests/").pop()}:${test.location.line}`;
  return `[${project}] ${where} › ${test.title}`;
}

export default class LiveReporter implements Reporter {
  onBegin(_config: FullConfig): void {
    console.log(`${clock()} RUN START`);
  }
  onTestBegin(test: TestCase): void {
    console.log(`${clock()} START ${label(test)}`);
  }
  onTestEnd(test: TestCase, result: TestResult): void {
    console.log(
      `${clock()} ${result.status.toUpperCase().padEnd(6)} ${label(test)} (${Math.round(result.duration / 100) / 10}s)`,
    );
  }
  onEnd(): void {
    console.log(`${clock()} RUN END`);
  }
}
