"use client";

import {
  Alert,
  Button,
  Flex,
  IconButton,
  List,
  ListItem,
  Tag,
  TextareaPrimitive,
  Typography,
} from "@oc-tech/omni-ui-components";
import {
  DynamicForm,
  type DynamicFormProps,
} from "@oc-tech/omni-ui-components/dynamic-form";
import type { DocumentField } from "@omnitech/interview-contracts";
import { type ComponentProps, createContext, useContext, useMemo } from "react";
import { z } from "zod";
import { Icon } from "../icon";
import type { FieldView } from "./document-editor-model";
import {
  DOCUMENT_FIELD_WIDGET,
  type DocumentBinding,
  type DocumentFormSection,
  documentFormConfig,
  fieldControlId,
  toFlatValues,
  toGroupedValues,
} from "./document-form-config";
import { CONTACT_HINT, claimReason, FIELD_STATE_TEXT } from "./documents-model";

// The document's fields as a form: the library's DynamicForm draws the
// sections, labels and controls from the template's fields
// (document-form-config.ts). This file adapts it: what a field shows beside
// its control, and the callbacks a field needs.

type AnyForm = DynamicFormProps<Record<string, unknown>, unknown>;
type Widgets = NonNullable<AnyForm["widgets"]>;
type WidgetProps = ComponentProps<Widgets[string]>;

export type DocumentFormActions = {
  focus(key: string): void;
  // A field was left: the draft is saved if it changed.
  leave(): void;
  regenerate(key: string): void;
  confirm(key: string): void;
};

type FormState = {
  views: Readonly<Record<string, FieldView>>;
  busy: boolean;
  older: boolean;
  actions: DocumentFormActions;
};
const FormStateContext = createContext<FormState | null>(null);

// [STRATEGY] The one widget: the library's textarea with the field's state
// around it. DynamicForm gives it the field's key, label, value and
// read-only flag from the schema; the editor's state comes by context, so a
// field redraws when its state changes and not otherwise.
function DocumentFieldWidget(props: WidgetProps) {
  const form = useContext(FormStateContext);
  const key = props.name;
  const view = form?.views[key];
  const text = typeof props.value === "string" ? props.value : "";
  const maxLength =
    typeof props.schema.maxLength === "number" ? props.schema.maxLength : null;
  const statusId = `${props.id}__status`;
  if (!form || !view) return null;
  const { state, issue, unsupported } = view;
  const explained =
    state === "type-it" || state === "no-evidence" || state === "unsupported";
  const note =
    state === "required"
      ? "Required by the template."
      : issue === "too-long"
        ? "Too long for the template."
        : issue && !explained
          ? "Unexpected field."
          : "";
  return (
    <Flex vertical gap={6}>
      <Flex align="center" gap={8} wrap="wrap">
        {!props.required && (
          <Typography.Text type="secondary" size="compact">
            optional
          </Typography.Text>
        )}
        {view.confirmed && <Tag variant="filled">Confirmed by you</Tag>}
        <Tag mono>{key}</Tag>
        {view.regenerating ? (
          <Tag>Regenerating…</Tag>
        ) : (
          view.regenerable && (
            <IconButton
              variant="ghost"
              iconSize="sm"
              icon={<Icon name="auto_awesome" />}
              label={`Regenerate ${props.label}`}
              disabled={form.busy}
              onClick={() => form.actions.regenerate(key)}
            />
          )
        )}
      </Flex>
      <TextareaPrimitive
        id={props.id}
        // The control grows with its text, up to eight lines.
        rows={Math.min(8, Math.max(1, Math.ceil(text.length / 56)))}
        value={text}
        readOnly={props.readonly || view.regenerating}
        placeholder={props.placeholder ?? ""}
        invalid={!!issue}
        aria-describedby={issue ? statusId : undefined}
        onFocus={() => form.actions.focus(key)}
        onChange={props.onChange}
        onBlur={() => form.actions.leave()}
      />
      {(state === "type-it" || state === "no-evidence") && (
        <Alert
          variant="warning"
          size="sm"
          id={statusId}
          title={FIELD_STATE_TEXT[state].title}
        >
          {state === "type-it" && view.contact
            ? CONTACT_HINT
            : FIELD_STATE_TEXT[state].body}
        </Alert>
      )}
      {unsupported && (
        <Alert
          variant="error"
          size="sm"
          id={statusId}
          title="Not in your experience matrix"
        >
          <List>
            {(unsupported.missing ?? []).map((claim) => (
              <ListItem key={`${claim.kind}:${claim.text}`}>
                {claimReason(
                  claim,
                  unsupported.against ?? "your experience matrix",
                )}
              </ListItem>
            ))}
          </List>
          {!form.older && (
            <Flex gap={8} wrap="wrap">
              {view.regenerable && (
                <Button
                  variant="outline"
                  buttonSize="sm"
                  disabled={form.busy}
                  onClick={() => form.actions.regenerate(key)}
                >
                  Regenerate this field
                </Button>
              )}
              <Button
                variant="outline"
                buttonSize="sm"
                disabled={form.busy}
                onClick={() => form.actions.confirm(key)}
              >
                Confirmed by me
              </Button>
            </Flex>
          )}
        </Alert>
      )}
      {(note || (maxLength !== null && (view.focused || issue))) && (
        <Flex justify="space-between" gap={8} id={note ? statusId : undefined}>
          <Typography.Text
            size="compact"
            type={issue === "too-long" ? "danger" : "warning"}
          >
            {note}
          </Typography.Text>
          {maxLength !== null && (
            <Typography.Text size="compact" type="secondary">
              {text.length} / {maxLength}
            </Typography.Text>
          )}
        </Flex>
      )}
    </Flex>
  );
}

// Registries are compared by reference: declared once.
const WIDGETS: Widgets = { [DOCUMENT_FIELD_WIDGET]: DocumentFieldWidget };
// Whether the values are acceptable is the document's own check
// (`validateDocumentValues`, and the server's): the form gates nothing.
const ANY_VALUES = z.record(
  z.string(),
  z.unknown(),
) as unknown as AnyForm["zodSchema"];
const never = () => undefined;

export function DocumentForm({
  fields,
  values,
  binding,
  readOnly,
  hidden,
  collapsed,
  epoch,
  views,
  busy,
  onChange,
  actions,
}: {
  fields: readonly DocumentField[];
  // The draft: flat, as it is stored.
  values: Readonly<Record<string, string>>;
  binding: DocumentBinding;
  // An older revision is on show.
  readOnly: boolean;
  hidden: readonly string[];
  collapsed: readonly string[];
  // Changes when the form must take its values and sections afresh.
  epoch: number;
  views: Readonly<Record<string, FieldView>>;
  busy: boolean;
  onChange(values: Record<string, string>): void;
  actions: DocumentFormActions;
}) {
  const config = useMemo(
    () =>
      documentFormConfig(fields, {
        binding,
        readOnly,
        hidden: new Set(hidden),
        collapsed: new Set(collapsed),
      }),
    [fields, binding, readOnly, hidden, collapsed],
  );
  const formData = useMemo(
    () => toGroupedValues(config.sections, values),
    [config.sections, values],
  );
  const state = useMemo(
    () => ({ views, busy, older: readOnly, actions }),
    [views, busy, readOnly, actions],
  );
  return (
    <FormStateContext.Provider value={state}>
      <DynamicForm
        key={epoch}
        schema={config.schema}
        uiSchema={config.uiSchema}
        zodSchema={ANY_VALUES}
        formData={formData}
        widgets={WIDGETS}
        readOnly={readOnly}
        onChange={(next) => {
          // [GUARD] Only what was typed changes the draft: a field the form
          // does not hold, or holds unchanged, keeps its stored value.
          const changed = Object.entries(
            toFlatValues(config.sections, next),
          ).filter(([key, value]) => (values[key] ?? "") !== value);
          if (changed.length)
            onChange({ ...values, ...Object.fromEntries(changed) });
        }}
        onSubmit={never}
      />
    </FormStateContext.Provider>
  );
}

/**
 * Bring a field's control into view and put the caret in it. The library's
 * form has no "focus a field by key" yet, so this finds the control by the id
 * the form gives it; it answers whether the control could take focus (it
 * cannot inside a section that is closed).
 */
export function focusDocumentField(
  sections: readonly DocumentFormSection[],
  key: string,
): boolean {
  const id = fieldControlId(sections, key);
  const control = id ? document.getElementById(id) : null;
  if (!control || control.closest("[hidden]")) return false;
  control.scrollIntoView?.({ block: "center", behavior: "smooth" });
  control.focus({ preventScroll: true });
  return true;
}
