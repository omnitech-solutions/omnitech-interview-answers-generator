import type {
  PlaygroundExplanation,
  PlaygroundPatch,
} from "@omnitech/interview-playground-control";
import { playgroundControlStore } from "../../workspace-control";
import { withRenderedPlaygroundAnswer } from "../domain/playground-answer";

export function readPlayground() {
  return playgroundControlStore.get();
}

export function updatePlayground(patch: PlaygroundPatch) {
  return playgroundControlStore.set(withRenderedPlaygroundAnswer(patch));
}

export function appendExplanation(explanation: PlaygroundExplanation) {
  return playgroundControlStore.appendExplanation(explanation);
}

export function resetPlayground() {
  return playgroundControlStore.reset();
}
