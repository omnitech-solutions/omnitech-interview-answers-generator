import type {
  RunAllRequest,
  RunRequest,
  SyntaxCheckRequest,
} from "@omnitech/interview-contracts";
import { bundleReactPreview } from "../../react-preview";
import { codeRunner } from "../../services";
import { previewComponentName } from "../domain/execution";

export function run(input: RunRequest) {
  return codeRunner.run(input);
}

export function checkSyntax(input: SyntaxCheckRequest) {
  return codeRunner.checkSyntax(input);
}

export function runAll(input: RunAllRequest) {
  return codeRunner.runAll(input);
}

export async function preview(code: string, componentName: unknown) {
  return {
    javascript: await bundleReactPreview(
      code,
      previewComponentName(componentName),
    ),
  };
}
