"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import { useEffect, useState } from "react";

import type { PresentationDocument } from "../../domain/index";

import { loadSharedPresentation } from "../presentation-client";

export function useSharedPresentation(props: ProductPageProps) {
  const { pathSegments } = props;
  const token = pathSegments[1];
  const [document, setDocument] = useState<PresentationDocument>();
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!token) return;
    return loadSharedPresentation(token, setDocument, (reason) =>
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load presentation.",
      ),
    );
  }, [token]);
  const slide = document?.slides[index];
  return { document, error, index, setIndex, slide };
}
