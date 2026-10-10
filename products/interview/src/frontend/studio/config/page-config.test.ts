import { expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { FormSchema, FormUiSchema } from "../shared/contract-form";
import type { ActionDescriptor, FormConfig, TableConfig } from "./page-config";

it("uses contract inputs and the shared form schema types", () => {
  const contract = z.object({ count: z.number().default(1) });
  expectTypeOf<FormConfig<typeof contract>["defaults"]>().toEqualTypeOf<{
    count?: number | undefined;
  }>();
  expectTypeOf<
    FormConfig<typeof contract>["schema"]
  >().toEqualTypeOf<FormSchema>();
  expectTypeOf<
    FormConfig<typeof contract>["uiSchema"]
  >().toEqualTypeOf<FormUiSchema>();
  expectTypeOf<
    TableConfig<{ id: string; title: string }>["rowKey"]
  >().toEqualTypeOf<"id" | "title">();
  expectTypeOf<
    ActionDescriptor<{ busy: boolean }>["available"]
  >().toEqualTypeOf<((context: { busy: boolean }) => boolean) | undefined>();
});
