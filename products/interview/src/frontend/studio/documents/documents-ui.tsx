"use client";

import {
  Button,
  Flex,
  Modal as LibraryModal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Tab,
  Tabs,
  TabsBar,
  Toast,
  Typography,
  useToast as useLibraryToast,
} from "@oc-tech/omni-ui-components";
import { type ReactNode, useCallback } from "react";
import { Icon, type IconName } from "../icon";
import { DocumentsApiError } from "./documents-client";

export function message(error: unknown): string {
  if (error instanceof DocumentsApiError) {
    if (error.code === "revision-conflict")
      return "A newer revision exists. Reload this document before editing.";
    if (error.code === "invalid-fields")
      return "The document contains invalid field values. Review the flagged fields.";
    if (error.code === "generation-unavailable")
      return "The selected model is unavailable. Choose another model.";
    if (error.code === "server-error")
      return "The Documents service returned an error. Check the server and database migrations.";
    if (error.code === "verification-failed")
      return "Export is blocked: a field says something your experience matrix does not. The Export control lists each one.";
    if (error.code === "source-refresh-required")
      return "The application changed since this document was written. Refresh source facts, then try again.";
    if (error.code === "body-too-large")
      return "The template file is too large.";
    if (error.code === "invalid-field-or-template")
      return "The template or fields could not be accepted.";
  }
  return "This action could not be completed. Try again.";
}

// A row of buttons described as data: the footer of a modal, the actions of a
// page or a drawer.
export type ActionSpec = {
  id: string;
  label: string;
  icon?: IconName;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default" | "lg";
  disabled?: boolean;
  ariaLabel?: string;
  onClick(): void;
};

export function Actions({ actions }: { actions: readonly ActionSpec[] }) {
  return (
    <>
      {actions.map((action) => (
        <Button
          key={action.id}
          type="button"
          variant={action.variant ?? "outline"}
          buttonSize={action.size ?? "default"}
          disabled={action.disabled}
          aria-label={action.ariaLabel}
          icon={action.icon ? <Icon name={action.icon} /> : undefined}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}
    </>
  );
}

// The page tabs: one tab per option, the chosen one is the page showing.
export function SectionTabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange(id: T): void;
}) {
  return (
    <Tabs value={value} onValueChange={(next: string) => onChange(next as T)}>
      <TabsBar aria-label={label}>
        {options.map((option) => (
          <Tab key={option.id} value={option.id}>
            {option.label}
          </Tab>
        ))}
      </TabsBar>
    </Tabs>
  );
}

export function PageHeader({
  title,
  description,
  tabs,
  action,
}: {
  title: string;
  description: string;
  tabs: ReactNode;
  action: ReactNode;
}) {
  return (
    <Flex align="center" gap={16} wrap="wrap" justify="space-between">
      <Flex vertical gap={4}>
        <Typography.Title>{title}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {description}
        </Typography.Paragraph>
      </Flex>
      {tabs}
      {action}
    </Flex>
  );
}

// A modal over the page: the library draws the scrim, the close control,
// Escape and the focus return.
export function Modal({
  title,
  width,
  onClose,
  footer,
  children,
}: {
  title: string;
  width: number;
  onClose(): void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <LibraryModal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        aria-describedby={undefined}
        style={{ width: `min(${width}px, 100%)` }}
      >
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
        </ModalHeader>
        <Flex vertical gap={12} style={{ padding: 16, overflow: "auto" }}>
          {children}
        </Flex>
        {footer ? <ModalFooter>{footer}</ModalFooter> : null}
      </ModalContent>
    </LibraryModal>
  );
}

export function useToast() {
  const toast = useLibraryToast();
  const { notify } = toast;
  const show = useCallback((text: string) => notify({ text }), [notify]);
  const node = toast.toast ? <Toast {...toast.props} /> : null;
  return { show, node };
}
