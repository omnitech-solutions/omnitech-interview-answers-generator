import type { TableColumn } from "@oc-tech/omni-ui-components";
import type { z } from "zod";
import type { IconName } from "../icon";
import type { FormSchema, FormUiSchema } from "../shared/contract-form";

export type ActionDescriptor<TContext = void> = {
  id: string;
  label: string;
  icon?: IconName;
  tone?: "primary" | "neutral" | "danger";
  shortcut?: string;
  available?(context: TContext): boolean;
  disabledReason?(context: TContext): string | null;
  confirm?: { title: string; description?: string; confirmLabel: string };
};
export type FormConfig<TContract extends z.ZodType> = {
  contract: TContract;
  schema: FormSchema;
  uiSchema: FormUiSchema;
  defaults: z.input<TContract>;
};
export type TableConfig<TRow> = {
  rowKey: keyof TRow & string;
  columns: TableColumn<TRow>[];
  rowActions: ActionDescriptor<TRow>[];
  toolbar: ActionDescriptor<{ selected: TRow[] }>[];
  empty: { title: string; description: string; actionId?: string };
};
