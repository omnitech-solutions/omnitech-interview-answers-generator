import { render, screen } from "@testing-library/react";
import type React from "react";
import { expect, it, vi } from "vitest";

const studio = vi.hoisted(() => ({ props: undefined as unknown }));
vi.mock("@omnitech/product-interview/frontend", () => ({
  Studio: (props: unknown) => {
    studio.props = props;
    return <div>Interview Studio</div>;
  },
}));
vi.mock("@omnitech-assistant/sdk", () => ({
  createAssistantClient: (options: unknown) => ({ options }),
}));

it("mounts Interview Studio bound to the local assistant workspace", async () => {
  const { App } = await vi.importActual<{ App: React.ComponentType }>(
    "../../../../apps/frontend/src/app.js",
  );
  render(<App />);
  expect(screen.getByText("Interview Studio")).toBeInTheDocument();
  expect(studio.props).toMatchObject({
    assistant: {
      client: { options: { baseUrl: "/api/assistant/v1" } },
      workspaceId: "interview",
      profileId: "local-interview",
    },
  });
});
