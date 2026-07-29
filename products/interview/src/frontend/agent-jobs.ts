export type ExecutionTarget =
  | {
      id: "openai" | "lm-studio";
      label: string;
      family: "direct-model";
      providerId: "openai" | "lm-studio";
    }
  | {
      id: "codex" | "claude-code";
      label: string;
      family: "agent-runtime";
      profileId: "coding-quality" | "document-quality";
    };

export const executionTargets: readonly ExecutionTarget[] = [
  {
    id: "openai",
    label: "OpenAI",
    family: "direct-model",
    providerId: "openai",
  },
  {
    id: "lm-studio",
    label: "LM Studio",
    family: "direct-model",
    providerId: "lm-studio",
  },
  {
    id: "codex",
    label: "Codex CLI",
    family: "agent-runtime",
    profileId: "coding-quality",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    family: "agent-runtime",
    profileId: "document-quality",
  },
];

export function currentTenantSlug(): string {
  return window.location.pathname.split("/")[2] ?? "local";
}

export async function createAgentJob(input: {
  profileId: string;
  prompt: string;
}): Promise<{ id: string; status: string }> {
  const response = await fetch(
    `/api/platform/v1/agent-jobs?tenant=${encodeURIComponent(currentTenantSlug())}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        productId: "omnitech.interview",
        profileId: input.profileId,
        prompt: input.prompt,
      }),
    },
  );
  const body = (await response.json()) as {
    id?: string;
    status?: string;
    error?: string;
  };
  if (!response.ok || !body.id) {
    throw new Error(body.error ?? "Unable to create agent job.");
  }
  return { id: body.id, status: body.status ?? "queued" };
}
