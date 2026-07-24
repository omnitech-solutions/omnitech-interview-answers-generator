# `@omnitech/interview-playground-control`

Typed SDK for controlling the live Interview Answers Playground form.

```ts
import { createPlaygroundControlClient } from "@omnitech/interview-playground-control";

const playground = createPlaygroundControlClient({
  baseUrl: "http://localhost:3000",
  token: process.env.INTERVIEW_API_TOKEN,
});

await playground.set({
  question: "Build an accessible React counter.",
  language: "react",
  notes: "Explain why the functional state updater is appropriate.",
  panel: "notes",
});
```

Configuration supports a custom base URL, API path, bearer token, headers,
timeout, and fetch implementation. The public client exposes only `get`, `set`,
and `reset`.
