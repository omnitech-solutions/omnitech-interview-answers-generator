import { describe, expect, it } from "vitest";
import { createOnDeviceProfile } from "./on-device";

const pin = "a".repeat(64);

describe("on-device AI profile", () => {
  it("is absent unless a model is pinned and WebGPU is available", () => {
    expect(createOnDeviceProfile({}, {})).toBeNull();
    expect(
      createOnDeviceProfile(
        { NEXT_PUBLIC_ON_DEVICE_MODEL_SHA256: "not-a-digest" },
        {},
      ),
    ).toBeNull();
    expect(
      createOnDeviceProfile(
        { NEXT_PUBLIC_ON_DEVICE_MODEL_SHA256: pin },
        undefined,
      ),
    ).toBeNull();
  });

  it("exposes the on-device profile without loading the model", async () => {
    const profile = createOnDeviceProfile(
      { NEXT_PUBLIC_ON_DEVICE_MODEL_SHA256: pin },
      {},
    );
    expect(profile?.profileId).toBe("on-device");
    expect(profile?.models.state("chat").status).toBe("unloaded");
    const listed = await profile?.catalog.list({
      tenantId: "t",
      actorId: "a",
      productId: "interview",
    });
    expect(listed?.models[0]).toMatchObject({ id: "on-device", local: true });
  });
});
