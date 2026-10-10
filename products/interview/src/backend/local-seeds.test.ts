import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadLocalContact } from "./local-seeds";

const CONTACT = {
  email: "rowan@example.invalid",
  phone: "555 0100",
  portfolio: "example.invalid/rowan",
};

it("reads the person's contact details from this machine, and never in production", async () => {
  const root = await mkdtemp(join(tmpdir(), "contact-"));
  try {
    const none = { env: {}, directory: root };
    expect(await loadLocalContact(none)).toBeNull();
    // The development default, found from a directory below the checkout
    // (a server may start in apps/web).
    await mkdir(join(root, ".dev-local/profile"), { recursive: true });
    await mkdir(join(root, "apps/web"), { recursive: true });
    await writeFile(
      join(root, ".dev-local/profile/contact.json"),
      JSON.stringify({ ...CONTACT, phone: "  555 0100 ", other: "ignored" }),
    );
    expect(await loadLocalContact(none)).toEqual(CONTACT);
    expect(
      await loadLocalContact({ env: {}, directory: join(root, "apps/web") }),
    ).toEqual(CONTACT);
    expect(await loadLocalContact({ ...none, production: true })).toBeNull();

    // The data directory wins over the development default, and a named
    // file over both.
    await mkdir(join(root, "data/profile"), { recursive: true });
    await writeFile(
      join(root, "data/profile/contact.json"),
      JSON.stringify({ email: "data@example.invalid" }),
    );
    const data = { INTERVIEW_DATA_DIR: join(root, "data") };
    expect(await loadLocalContact({ env: data, directory: root })).toEqual({
      email: "data@example.invalid",
    });
    await writeFile(
      join(root, "named.json"),
      JSON.stringify({ portfolio: "named.example.invalid", email: 42 }),
    );
    expect(
      await loadLocalContact({
        env: { ...data, INTERVIEW_CONTACT_PATH: join(root, "named.json") },
        directory: root,
      }),
    ).toEqual({ portfolio: "named.example.invalid" });

    // A file that is not a JSON object of strings gives nothing, quietly.
    for (const bad of ["not json", "[]", '"text"']) {
      await writeFile(join(root, "named.json"), bad);
      expect(
        await loadLocalContact({
          env: { INTERVIEW_CONTACT_PATH: join(root, "named.json") },
          directory: root,
        }),
      ).toBeNull();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
