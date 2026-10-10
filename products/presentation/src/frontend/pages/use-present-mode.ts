"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  PresentationDocument,
  PresentationRecording,
} from "../../domain/index";

import { createPresentationClient } from "../presentation-client";

export function usePresentMode({ tenantSlug, pathSegments }: ProductPageProps) {
  const client = useMemo(
    () => createPresentationClient(tenantSlug),
    [tenantSlug],
  );
  const id = pathSegments[1];
  const [document, setDocument] = useState<PresentationDocument>();
  const [loadError, setLoadError] = useState("");
  const [index, setIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("");
  const [recordings, setRecordings] = useState<PresentationRecording[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingChunks = useRef<BlobPart[]>([]);
  useEffect(() => {
    if (!id) return;
    const stopDocument = client.loadDocument(id, setDocument, (reason) =>
      setLoadError(
        reason instanceof Error
          ? reason.message
          : "Unable to load presentation.",
      ),
    );
    const stopRecordings = client.loadRecordings(id, setRecordings);
    return () => {
      stopDocument();
      stopRecordings();
    };
  }, [id, client]);
  const slide = document?.slides[index];
  async function startRecording() {
    if (!document || !navigator.mediaDevices?.getDisplayMedia) {
      setRecordingStatus("Screen recording is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const nextRecorder = new MediaRecorder(stream);
      recordingChunks.current = [];
      nextRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunks.current.push(event.data);
      };
      nextRecorder.onstop = () => {
        void (async () => {
          const blob = new Blob(recordingChunks.current, {
            type: nextRecorder.mimeType || "video/webm",
          });
          const assetReference = await new Promise<string>(
            (resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                typeof reader.result === "string"
                  ? resolve(reader.result)
                  : reject(new Error("Unable to read recording."));
              reader.onerror = () =>
                reject(reader.error ?? new Error("Unable to read recording."));
              reader.readAsDataURL(blob);
            },
          );
          const saved = await client.saveRecording(document.id, {
            assetReference,
            metadata: { mimeType: blob.type, size: blob.size },
          });
          setRecordings((current) => [
            {
              id: saved.id,
              assetReference,
              metadata: { mimeType: blob.type, size: blob.size },
              createdAt: new Date().toISOString(),
            },
            ...current,
          ]);
          setRecordingStatus("Recording saved.");
        })().catch((reason: unknown) =>
          setRecordingStatus(
            reason instanceof Error ? reason.message : "Recording failed.",
          ),
        );
        for (const track of stream.getTracks()) track.stop();
        setRecording(false);
      };
      recorder.current = nextRecorder;
      nextRecorder.start();
      setRecording(true);
      setRecordingStatus("Recording…");
    } catch (reason) {
      setRecordingStatus(
        reason instanceof Error ? reason.message : "Recording was cancelled.",
      );
    }
  }
  function stopRecording() {
    recorder.current?.stop();
  }
  return {
    id,
    document,
    loadError,
    index,
    setIndex,
    recording,
    recordingStatus,
    recordings,
    slide,
    startRecording,
    stopRecording,
  };
}
