// What each kind of task is called and drawn as, in one place. A leaf module:
// the task card model, the panels and the transcript all read it, and none of
// them may be imported back from here.
import type { IconName } from "../../icon";
import type { TaskKind } from "../session-tasks";

export const TASK_KIND: Record<TaskKind, { label: string; icon: IconName }> = {
  "experience-question": { label: "Experience question", icon: "psychology" },
  "leadership-behavioural": { label: "Behavioural question", icon: "star" },
  logistics: { label: "Logistics question", icon: "checklist" },
  concept: { label: "Concept question", icon: "school" },
  "programming-challenge": { label: "Programming challenge", icon: "code" },
  other: { label: "Question", icon: "help" },
  unclassified: { label: "New task", icon: "pending" },
};
