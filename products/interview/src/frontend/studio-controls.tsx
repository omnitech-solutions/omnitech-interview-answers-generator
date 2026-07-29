"use client";

import React, {
  type ButtonHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from "react";

interface StudioButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline";
}

export function StudioButton({
  className = "",
  type = "button",
  variant = "default",
  ...props
}: StudioButtonProps) {
  return (
    <button
      type={type}
      className={`studio-button ${variant === "outline" ? "outline" : ""} ${className}`}
      {...props}
    />
  );
}

interface StudioTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  description?: string;
  label?: string;
  onChange?: (value: string) => void;
}

export function StudioTextarea({
  description,
  label,
  onChange,
  id: providedId,
  ...props
}: StudioTextareaProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const descriptionId = description ? `${id}-description` : undefined;
  const textarea = (
    <textarea
      id={id}
      aria-describedby={descriptionId}
      className="studio-textarea"
      onChange={(event) => onChange?.(event.target.value)}
      {...props}
    />
  );

  if (!label && !description) return textarea;

  return (
    <div className="studio-field">
      {label ? (
        <label htmlFor={id}>
          <span>{label}</span>
        </label>
      ) : null}
      {description ? <small id={descriptionId}>{description}</small> : null}
      {textarea}
    </div>
  );
}
