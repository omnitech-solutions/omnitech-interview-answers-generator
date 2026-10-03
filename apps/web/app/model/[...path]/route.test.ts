// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET } from "./route";

// A packed on-device model: a manifest and one weights file.
let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "on-device-model-"));
  mkdirSync(join(root, "onnx"));
  writeFileSync(join(root, "manifest.json"), '{"files":2}');
  writeFileSync(join(root, "onnx", "model.safetensors"), "0123456789");
  writeFileSync(join(root, "tokenizer.model"), "tok");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const get = (path: string[], range?: string) =>
  GET(
    new Request(`https://app.test/model/${path.join("/")}`, {
      headers: range ? { range } : {},
    }),
    { params: Promise.resolve({ path }) },
  );

describe("the on-device model's files", () => {
  it("are not served unless a model directory is configured", async () => {
    vi.stubEnv("ON_DEVICE_MODEL_DIR", "");
    expect((await get(["manifest.json"])).status).toBe(404);
  });

  it("serves a whole file with its type and length", async () => {
    vi.stubEnv("ON_DEVICE_MODEL_DIR", root);
    const response = await get(["manifest.json"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-length")).toBe("11");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await response.text()).toBe('{"files":2}');
    // Anything without a known extension downloads as bytes.
    expect((await get(["tokenizer.model"])).headers.get("content-type")).toBe(
      "application/octet-stream",
    );
  });

  it("resumes a download from a byte range", async () => {
    vi.stubEnv("ON_DEVICE_MODEL_DIR", root);
    const part = await get(["onnx", "model.safetensors"], "bytes=2-5");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(part.headers.get("content-length")).toBe("4");
    expect(await part.text()).toBe("2345");

    const rest = await get(["onnx", "model.safetensors"], "bytes=7-");
    expect(rest.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(await rest.text()).toBe("789");

    const clipped = await get(["onnx", "model.safetensors"], "bytes=8-99");
    expect(await clipped.text()).toBe("89");
  });

  it("refuses a range outside the file", async () => {
    vi.stubEnv("ON_DEVICE_MODEL_DIR", root);
    const response = await get(["manifest.json"], "bytes=50-60");
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */11");
    expect((await get(["manifest.json"], "bytes=5-2")).status).toBe(416);
  });

  it("never serves a directory, a missing file or a path out of the model", async () => {
    vi.stubEnv("ON_DEVICE_MODEL_DIR", root);
    expect((await get(["onnx"])).status).toBe(404);
    expect((await get(["missing.bin"])).status).toBe(404);
    expect((await get(["..", "..", "etc", "hosts"])).status).toBe(404);
  });
});
