import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { expect, it, vi } from "vitest";

vi.mock("@omnitech/product-interview/frontend", () => ({
  Workspace: ({
    assistant,
    onPreparationDirtyChange,
  }: {
    assistant: { artifactId: string };
    onPreparationDirtyChange?: (dirty: boolean) => void;
  }) => (
    <div>
      <span>Workspace artifact: {assistant.artifactId}</span>
      <button type="button" onClick={() => onPreparationDirtyChange?.(true)}>
        Make preparation dirty
      </button>
    </div>
  ),
}));
vi.mock("@omnitech-assistant/sdk", () => ({
  createAssistantClient: () => ({}),
}));

it("keeps dirty preparation mounted until the operator confirms replacing the question", async () => {
  history.replaceState({}, "", "/t/local/p/interview?artifact=first");
  const { App } = await vi.importActual<{ App: React.ComponentType }>(
    "../../../../apps/frontend/src/app.js",
  );
  render(<App />);
  await screen.findByText("Workspace artifact: first");
  fireEvent.click(
    screen.getByRole("button", { name: "Make preparation dirty" }),
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Question identifier" }),
    { target: { value: "second" } },
  );
  const confirm = vi
    .spyOn(window, "confirm")
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "Open question" }));
  expect(screen.getByText("Workspace artifact: first")).toBeInTheDocument();
  expect(location.search).toContain("artifact=first");
  fireEvent.click(screen.getByRole("button", { name: "Open question" }));
  await waitFor(() =>
    expect(screen.getByText("Workspace artifact: second")).toBeInTheDocument(),
  );
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(location.search).toContain("artifact=second");
});
