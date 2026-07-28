import type { LibraryItemInput } from "@omnitech/interview-contracts";

function symfony(
  slug: string,
  title: string,
  summary: string,
  tags: string[],
  body: string,
): LibraryItemInput {
  return {
    slug,
    title,
    summary,
    body,
    contentType: "cheat-sheet",
    collection: "symfony",
    tags: ["symfony", "symfony-8-1", ...tags],
  };
}

export const symfonyLibrarySeed: LibraryItemInput[] = [
  symfony(
    "symfony-request-lifecycle",
    "Symfony Request Lifecycle",
    "A compact map from HttpKernel request to controller response.",
    ["http-kernel", "routing", "events", "controllers"],
    `# Symfony Request Lifecycle

## HttpKernel

\`HttpKernel::handle()\` turns a Request into a Response. Kernel events allow
focused cross-cutting behavior before and after controller execution.

## Request flow

1. \`kernel.request\` may supply a response early.
2. Routing adds route and controller attributes to the request.
3. Argument resolvers build controller arguments.
4. The controller returns a Response or a value handled by \`kernel.view\`.
5. \`kernel.response\` can adjust the response; \`kernel.terminate\` runs after
   it is sent when the server integration supports it.

## Interview rule

Use middleware-like subscribers for transport concerns. Keep business rules in
application services so they remain independent of the HTTP lifecycle.`,
  ),
  symfony(
    "symfony-service-container",
    "Symfony Service Container",
    "Autowiring, autoconfiguration, aliases, and service lifetimes at a glance.",
    ["service-container", "autowiring", "dependency-injection"],
    `# Symfony Service Container

## Autowiring

Constructor type hints identify dependencies. Use an alias when an interface
has one selected implementation and an explicit binding when a scalar or
ambiguous dependency needs context.

## Autoconfiguration

Known interfaces and attributes add useful tags automatically, allowing
handlers, commands, subscribers, and other extension points to be discovered.

## Interview caveat

Services are shared by default. Keep them stateless unless shared state is
intentional, and prefer constructor injection over fetching services from the
container.`,
  ),
  symfony(
    "symfony-backend-cheat-sheet",
    "Symfony Backend Cheat Sheet",
    "Routing, validation, Doctrine, security, Messenger, and cache talking points.",
    ["doctrine", "messenger", "validation", "security", "cache"],
    `# Symfony Backend Cheat Sheet

## Routing and controllers

Use \`#[Route]\` attributes to map HTTP methods and paths. Controllers should
translate transport input into an application call and return a Response.

## Validation and Doctrine

Validator constraints check object and input rules. Doctrine's EntityManager
tracks entity changes; repositories express persistence queries. Avoid N+1
queries and wrap atomic multi-write operations in a transaction.

## Security

Firewalls authenticate requests; access controls and voters authorize actions.
Keep authentication identity separate from domain permission decisions.

## Messenger

Commands and events can be handled synchronously or routed to an asynchronous
transport. Make handlers idempotent and configure retries and failure
transports.

## Cache

Use cache contracts for read-through caching and cache pools for direct item
control. Include all result-changing inputs in keys and define invalidation
before adding a cache.`,
  ),
];
