import { z } from "zod";

// Opaque identifier: the safe alphabet keeps ids usable in traces and headers.
export const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const isoTimestampSchema = z.iso.datetime({ offset: true });

export const WIRE_VERSION = 1 as const;
export const wireVersionSchema = z.literal(WIRE_VERSION);

// The one set of source labels the companion may name. The set is fixed by the
// session record at start; the companion cannot broaden it.
export const captureSourceSchema = z.enum([
  "microphone",
  "application-audio",
  "screen",
]);
export type CaptureSource = z.infer<typeof captureSourceSchema>;
