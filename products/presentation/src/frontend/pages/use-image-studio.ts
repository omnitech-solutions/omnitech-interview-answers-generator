"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import { useEffect, useMemo, useState } from "react";

import type { GeneratedImage } from "../../domain/index";

import { createPresentationClient } from "../presentation-client";

export function useImageStudio({ tenantSlug }: ProductPageProps) {
  const client = useMemo(
    () => createPresentationClient(tenantSlug),
    [tenantSlug],
  );
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [modelId, setModelId] = useState("");
  const [status, setStatus] = useState("");
  useEffect(
    () =>
      client.loadImages(setImages, (reason) =>
        setStatus(
          reason instanceof Error ? reason.message : "Unable to load images.",
        ),
      ),
    [client],
  );
  async function generate() {
    setStatus("Generating…");
    try {
      await client.generateImage({
        prompt,
        profileId: "image-balanced",
        aspectRatio,
        ...(modelId.trim() ? { modelId: modelId.trim() } : {}),
      });
      const refreshed = await client.listImages();
      setImages(refreshed);
      setStatus("Image generated and persisted.");
    } catch (reason) {
      setStatus(
        reason instanceof Error ? reason.message : "Generation failed.",
      );
    }
  }
  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      setStatus("Choose an image file.");
      return;
    }
    setStatus("Saving image…");
    try {
      const assetReference = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("Unable to read image."));
        reader.onerror = () =>
          reject(reader.error ?? new Error("Unable to read image."));
        reader.readAsDataURL(file);
      });
      await client.uploadImage({ assetReference, mimeType: file.type });
      setImages(await client.listImages());
      setStatus("Image uploaded.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Upload failed.");
    }
  }
  return {
    images,
    prompt,
    setPrompt,
    aspectRatio,
    setAspectRatio,
    modelId,
    setModelId,
    status,
    generate,
    upload,
  };
}
