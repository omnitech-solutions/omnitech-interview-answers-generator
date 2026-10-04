# PB-0003 live measurements — 2026-10-03

All trials ran on the same local machine against the installed Codex CLI 0.160.0 and Claude Code 2.1.288. The scripts record metrics only. The synthetic resume, template, and matrix in `scripts/benchmark-document-groups.ts` contain no private candidate data. Each provider received the same fixture for one, three, four, and five model groups, with ten trials per grouping. Trial order rotates to reduce warmup bias. Each JSONL file contains the individual trials and failures.

The fixture has 15 model-owned fields. The product's current `fieldsPerCall: 24` setting makes **one group** on this fixture. The four-group case is a forced comparison, not this fixture's current behavior. “First field” is the time until the first server-validated model batch, not browser paint. Browser visibility and the production Opus document target remain unmeasured. Codex cost was not reported, so neither provider's data authorizes a default grouping change under ADR-0015.

| Provider | Groups | Trials | Median first validated field | Median total | p95 total | Median reported cost | Failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude Sonnet | 1 | 10 | 9,704 ms | 9,704 ms | 13,209 ms | $0.016839 | 0 |
| Claude Sonnet | 3 | 10 | 6,177 ms | 10,097 ms | 13,012 ms | $0.034800 | 0 |
| Claude Sonnet | 4 | 10 | 6,984 ms | 12,115 ms | 21,988 ms | $0.057181 | 0 |
| Claude Sonnet | 5 | 10 | 6,882 ms | 16,139 ms | 26,780 ms | $0.072659 | 0 |
| Codex gpt-6-luna | 1 | 10 | 6,320 ms | 6,320 ms | 7,690 ms | unavailable | 0 |
| Codex gpt-6-luna | 3 | 10 | 3,680 ms | 5,249 ms | 7,405 ms | unavailable | 0 |
| Codex gpt-6-luna | 4 | 10 | 3,769 ms | 7,220 ms | 14,579 ms | unavailable | 0 |
| Codex gpt-6-luna | 5 | 10 | 3,784 ms | 6,113 ms | 8,350 ms | unavailable | 0 |

The transport trials used the same short prompt for ten paired turns per provider, alternating order. Codex's existing SDK median completion was 4,535.5 ms versus 2,531.5 ms with App Server; median first text was 2,991.5 ms versus 2,416 ms. The completion p95 was 5,388 ms for SDK and 6,950 ms for App Server, a 29% regression that exceeds ADR-0014's 10% limit. Both had zero failures. The operator directed a single Codex transport, so App Server is now the sole runtime despite this failed ADR-0014 latency gate. The tail-latency regression and tool-using profile isolation remain unresolved.

Claude one-shot median completion was 2,757 ms versus 843 ms for a retained SDK query; median first text was 1,631.5 ms versus 833.5 ms. The retained session carried growing conversation context and had median reported turn cost $0.0069255 versus $0.0005385 for one-shot after cache warmup. Its completion p95 was 4,077 ms versus 2,870 ms for one-shot. Both had zero failures. The pool applies only to profiles that explicitly request session persistence and no model tools. These transport samples show a workload-specific tradeoff, not a general performance guarantee.

A separate live Codex control asked the model to read a throwaway file. With the shell feature enabled it made one command call and returned the nonce. With the no-tools App Server configuration it made zero command calls and did not return the nonce. This verifies the tested shell boundary for tool-less jobs. It does not establish owner-scoped provider history or credential isolation for coding profiles that request file tools; those continue on the established SDK path.

Files: `document-claude-sonnet.jsonl`, `document-codex-luna.jsonl`, `transport-claude-sonnet.jsonl`, and `transport-codex-luna.jsonl`.
