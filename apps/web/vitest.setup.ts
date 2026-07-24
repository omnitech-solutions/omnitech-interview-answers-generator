// oxlint-disable-next-line import/no-unassigned-import -- installs RTL matchers
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
