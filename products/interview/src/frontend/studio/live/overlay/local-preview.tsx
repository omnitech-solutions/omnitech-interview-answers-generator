// A live preview of the shared source. It is the stream itself played in a
// <video> in this document: nothing here is uploaded.
import { useEffect, useRef } from "react";

export function LocalPreview({
  stream,
  className,
  onAspect,
  onSize,
}: {
  stream: MediaStream | null;
  className?: string;
  // The source's aspect ratio (width / height) once it is known.
  onAspect?(ratio: number): void;
  // The source's real size in pixels once it is known.
  onSize?(width: number, height: number): void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = stream;
    if (stream) void Promise.resolve(element.play()).catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={video}
      className={className}
      muted
      playsInline
      aria-hidden="true"
      data-testid="local-preview"
      onLoadedMetadata={(event) => {
        const { videoWidth, videoHeight } = event.currentTarget;
        if (videoWidth && videoHeight) {
          onAspect?.(videoWidth / videoHeight);
          onSize?.(videoWidth, videoHeight);
        }
      }}
    />
  );
}
