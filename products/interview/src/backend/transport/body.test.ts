import { describe, expect, it, vi } from "vitest";
import { BodyRefused, readBytes, readJson, readUpload } from "./body";

const post = (body?: BodyInit, headers?: HeadersInit) =>
  new Request("http://studio/body", {
    method: "POST",
    ...(body === undefined ? {} : { body }),
    ...(headers === undefined ? {} : { headers }),
  });
const streamed = (chunks: Uint8Array[], cancel = vi.fn()) => {
  let at = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[at++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel,
  });
  return new Request("http://studio/body", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
};

describe("bounded bodies", () => {
  it("rejects a declared oversized body without reading it and cancels", async () => {
    const request = post("private", { "content-length": "7" });
    const read = vi.spyOn(request.body as ReadableStream, "getReader");
    const cancel = vi.spyOn(request.body as ReadableStream, "cancel");
    await expect(readJson(request, 6)).rejects.toMatchObject({
      code: "body-too-large",
    });
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("counts stream bytes despite absent or dishonest headers and cancels on overflow", async () => {
    const cancel = vi.fn();
    const request = streamed(
      [new Uint8Array(3), new Uint8Array(4), new Uint8Array(100)],
      cancel,
    );
    request.headers.set("content-length", "1");
    await expect(readBytes(request, 6)).rejects.toMatchObject({
      code: "body-too-large",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(request.body?.locked).toBe(false);
  });

  it("accepts the exact byte bound, including UTF-8 text", async () => {
    const body = JSON.stringify({ word: "é" });
    const size = Buffer.byteLength(body);
    await expect(readJson(post(body), size)).resolves.toEqual({ word: "é" });
    await expect(readJson(post(body), size - 1)).rejects.toMatchObject({
      code: "body-too-large",
    });
    await expect(readBytes(post("abc"), 3)).resolves.toEqual(
      Buffer.from("abc"),
    );
  });

  it.each([undefined, "", "{private", " "])(
    "refuses empty or malformed JSON without echoing content (%s)",
    async (body) => {
      await expect(readJson(post(body), 100)).rejects.toMatchObject({
        name: "BodyRefused",
        code: "invalid-request",
        message: "invalid-request",
      });
    },
  );

  it("maps a broken stream to invalid-request and releases its lock", async () => {
    const request = new Request("http://studio/body", {
      method: "POST",
      duplex: "half",
      body: new ReadableStream({
        start(c) {
          c.error(new Error("private"));
        },
      }),
    } as RequestInit);
    await expect(readBytes(request, 100)).rejects.toBeInstanceOf(BodyRefused);
    expect(request.body?.locked).toBe(false);
  });

  it("bounds multipart bytes before parsing and returns the file and other fields", async () => {
    const form = new FormData();
    form.set("file", new Blob(["abc"]), "sample.txt");
    form.set("label", "sample");
    const request = post(form);
    const size = (await request.clone().arrayBuffer()).byteLength;
    const result = await readUpload(request, size, "file");
    expect(result.file.name).toBe("sample.txt");
    expect(await result.file.text()).toBe("abc");
    expect(result.form.get("label")).toBe("sample");
    await expect(
      readUpload(post(form), size - 1, "file"),
    ).rejects.toMatchObject({ code: "body-too-large" });
  });

  it("refuses missing, text-only and malformed upload fields", async () => {
    for (const value of [null, "text"]) {
      const form = new FormData();
      if (value) form.set("file", value);
      await expect(readUpload(post(form), 1000, "file")).rejects.toMatchObject({
        code: "invalid-request",
      });
    }
    await expect(
      readUpload(
        post("broken", { "content-type": "multipart/form-data" }),
        100,
        "file",
      ),
    ).rejects.toMatchObject({ code: "invalid-request" });
  });

  it.each([-1, NaN, Infinity, 1.5])(
    "rejects an invalid developer-supplied limit (%s)",
    async (limit) => {
      await expect(readBytes(post("abc"), limit)).rejects.toBeInstanceOf(
        RangeError,
      );
    },
  );
});
