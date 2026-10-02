import {
  createOnDeviceModelCatalog,
  createOnDeviceModelPort,
  createOnDeviceModels,
  ON_DEVICE_PROFILE,
} from "@omnitech-assistant/provider-on-device";

/**
 * Opt-in browser model for the "on-device" AI profile. It exists only when the deployment pins a
 * model (NEXT_PUBLIC_ON_DEVICE_MODEL_SHA256) and the browser has WebGPU. Nothing loads until a
 * user action calls `models.load("chat")`; callers select it by profile id, never by provider.
 */
export function createOnDeviceProfile(
  env: Readonly<Record<string, string | undefined>> = process.env,
  gpu: unknown = (globalThis.navigator as { gpu?: unknown } | undefined)?.gpu,
) {
  const manifestSha256 = env["NEXT_PUBLIC_ON_DEVICE_MODEL_SHA256"]?.trim();
  if (!manifestSha256 || !/^[a-f0-9]{64}$/.test(manifestSha256) || !gpu)
    return null;
  const manifestUrl =
    env["NEXT_PUBLIC_ON_DEVICE_MODEL_URL"]?.trim() || "/model/manifest.json";
  const models = createOnDeviceModels({ manifestUrl, manifestSha256 });
  return {
    profileId: ON_DEVICE_PROFILE,
    models,
    port: createOnDeviceModelPort({ models }),
    catalog: createOnDeviceModelCatalog({ models }),
  };
}
