import type { LibraryItemInput } from "@omnitech/interview-contracts";

const code = (language: string, source: string, explanation: string) =>
  `\`\`\`${language}\n${source}\n\`\`\`\n\n${explanation}`;

const scenario = (text: string) => text;

const usageBySlug: Record<string, string> = {
  "react-state": code(
    "tsx",
    "const [quoteDraft, setQuoteDraft] = useState<QuoteDraft>(emptyQuote);",
    "The broker's editable quote belongs in state because every field change must update the screen.",
  ),
  "react-effects": code(
    "tsx",
    "useEffect(() => carrierApi.subscribe(quoteId, setQuotes), [quoteId]);",
    "The effect keeps the quote screen synchronized with an external carrier feed.",
  ),
  "react-sharing-state": code(
    "tsx",
    "<QuoteWorkspace draft={draft} onDraftChange={setDraft} />",
    "The workspace owns the quote draft so broker inputs and carrier results cannot disagree.",
  ),
  "react-memoization": code(
    "tsx",
    "const ranked = useMemo(() => rankQuotes(quotes), [quotes]);",
    "Memoize ranking only after profiling shows it is expensive.",
  ),
  "react-transitions": code(
    "tsx",
    "startTransition(() => setCarrierFilter(nextFilter));",
    "Typing stays urgent while a large carrier table updates in the background.",
  ),
  "react-strict-mode": code(
    "tsx",
    "useEffect(() => carrierApi.subscribe(quoteId), [quoteId]); // Cleanup is required.",
    "Strict Mode exposes a missing unsubscribe before it duplicates a carrier subscription in production logic.",
  ),
  "react-pure-components": code(
    "tsx",
    "const premium = calculatePremium(quote, rates);",
    "Rendering calculates the displayed premium without mutating the quote or carrier rates.",
  ),
  "react-preserving-resetting-state": code(
    "tsx",
    "<CarrierForm key={carrierId} carrierId={carrierId} />",
    "Changing carriers resets carrier-specific form state instead of leaking the previous carrier's answers.",
  ),
  "react-reducer": code(
    "tsx",
    'dispatch({ type: "carrier-quoted", quote: carrierQuote });',
    "Named events keep the multi-step quote workflow explicit and testable.",
  ),
  "react-context": code(
    "tsx",
    "<BrokerageContext value={brokerage}>{children}</BrokerageContext>",
    "Stable brokerage configuration is available to quote screens without threading it through every component.",
  ),
  "react-refs-dom": code(
    "tsx",
    "brokerSearchRef.current?.focus();",
    "The ref performs one deliberate browser action after the quote panel opens.",
  ),
  "react-custom-hooks": code(
    "tsx",
    "const quotes = useCarrierQuotes(quoteId);",
    "The hook packages carrier subscription behavior while each quote screen keeps independent state.",
  ),
  "react-deferred-value": code(
    "tsx",
    "const deferredBrokerQuery = useDeferredValue(brokerQuery);",
    "The input remains responsive while thousands of carrier quotes are filtered.",
  ),
  "react-use": code(
    "tsx",
    "const carrierQuotes = use(carrierQuotesPromise);",
    "A Suspense-aware quote route reads the carrier response during rendering.",
  ),
  "react-suspense": code(
    "tsx",
    "<Suspense fallback={<QuoteSkeleton />}><CarrierQuotes /></Suspense>",
    "The existing quote shell remains stable while carrier results load.",
  ),
  "react-memo": code(
    "tsx",
    "const CarrierQuoteRow = memo(CarrierQuoteRowView);",
    "Measured row rendering is skipped when a carrier quote's props are unchanged.",
  ),
  "react-use-layout-effect": code(
    "tsx",
    "useLayoutEffect(() => positionBrokerMenu(anchorRef.current), []);",
    "The broker menu is measured before paint to avoid a visible jump.",
  ),
  "react-accessibility": code(
    "tsx",
    '<button aria-describedby="bind-help">Bind selected quote</button>',
    "A broker can understand and operate the bind action with a keyboard and assistive technology.",
  ),
  "react-render-performance": code(
    "tsx",
    "<VirtualizedQuoteTable rows={carrierQuotes} />",
    "Virtualization limits mounted rows before smaller memoization optimizations are considered.",
  ),
  "php-8-4": code(
    "php",
    "public string $status { get => $this->status; private set; }",
    "Asymmetric visibility exposes quote status while keeping carrier updates controlled.",
  ),
  "php-arrays": code(
    "php",
    "$quotesByCarrier[$quote['carrierId']] = $quote;",
    "An associative array provides direct access to each carrier quote.",
  ),
  "php-strings": code(
    "php",
    "$carrierKey = strtoupper(trim($carrierCode));",
    "Normalize a carrier code before using it in a lookup or cache key.",
  ),
  "php-types": code(
    "php",
    "function bindQuote(QuoteId $id, CarrierQuote $quote): BoundPolicy",
    "Narrow types make the quote-binding boundary explicit.",
  ),
  "php-classes-objects": code(
    "php",
    "$service = new QuoteService($carrierGateway, $policyRepository);",
    "Constructor injection keeps carrier and policy dependencies visible.",
  ),
  "php-exceptions": code(
    "php",
    "throw new CarrierUnavailable($carrierId, previous: $exception);",
    "Translate a provider failure while preserving its original cause.",
  ),
  "php-pdo": code(
    "php",
    "$statement = $pdo->prepare('SELECT * FROM quotes WHERE broker_id = :broker');",
    "Bind the broker ID separately from SQL to protect the query boundary.",
  ),
  "php-generators": code(
    "php",
    "foreach (streamCarrierQuotes($brokerId) as $quote) { yield $quote; }",
    "Stream a large carrier portfolio without loading every quote into memory.",
  ),
  "php-enumerations": code(
    "php",
    "enum QuoteStatus: string { case Draft = 'draft'; case Bound = 'bound'; }",
    "A backed enum prevents invalid quote-status values.",
  ),
  "laravel-13": code(
    "php",
    "Route::post('/quotes', CreateQuoteController::class);",
    "The request enters through routing, middleware, validation, and an injected application action.",
  ),
  "laravel-service-container": code(
    "php",
    "$this->app->bind(CarrierGateway::class, AcmeCarrierGateway::class);",
    "The quote service depends on a carrier contract rather than one provider SDK.",
  ),
  "laravel-service-providers": code(
    "php",
    "$this->app->singleton(CarrierRegistry::class);",
    "A provider registers the carrier registry once during application bootstrapping.",
  ),
  "laravel-routing": code(
    "php",
    "Route::get('/quotes/{quote}', ShowQuoteController::class)->scopeBindings();",
    "Scoped binding prevents a broker from resolving a quote outside its account.",
  ),
  "laravel-middleware": code(
    "php",
    "return $broker->canAccess($request->route('quote')) ? $next($request) : abort(403);",
    "Middleware rejects an unauthorized quote request before controller work.",
  ),
  "laravel-validation": code(
    "php",
    "'annual_revenue' => ['required', 'integer', 'min:0'],",
    "A Form Request rejects malformed underwriting data at the HTTP boundary.",
  ),
  "laravel-eloquent": code(
    "php",
    "$quotes = Quote::query()->whereBelongsTo($broker)->latest()->paginate();",
    "The query limits broker data and avoids loading an unbounded portfolio.",
  ),
  "laravel-eloquent-relationships": code(
    "php",
    "$quotes = Quote::with(['carrier', 'policy'])->whereBelongsTo($broker)->get();",
    "Eager loading prevents an N+1 query while rendering carrier and policy details.",
  ),
  "laravel-query-builder": code(
    "php",
    "$totals = DB::table('quotes')->selectRaw('carrier_id, count(*) total')->groupBy('carrier_id')->get();",
    "The database computes carrier totals without hydrating full models.",
  ),
  "laravel-collections": code(
    "php",
    "$bestByCarrier = $quotes->groupBy('carrier_id')->map->sortBy('premium')->map->first();",
    "The broker receives the lowest premium from each carrier.",
  ),
  "laravel-queues": code(
    "php",
    "FetchCarrierQuote::dispatch($quote->id, $carrier->id)->afterCommit();",
    "The worker cannot request a carrier quote before the local quote transaction commits.",
  ),
  "laravel-cache": code(
    "php",
    '$appetite = Cache::remember("carrier:$carrierId:appetite", 300, $load);',
    "Carrier appetite is reused briefly with every result-changing input in the key.",
  ),
  "laravel-events": code(
    "php",
    "QuoteBound::dispatch($quote->id, $policy->id);",
    "Listeners can notify the broker and carrier after the policy is committed.",
  ),
  "laravel-testing": code(
    "php",
    "Queue::fake(); $this->postJson('/quotes', $payload)->assertCreated();",
    "The feature test verifies quote creation and queued carrier work independently.",
  ),
  "symfony-request-lifecycle": code(
    "php",
    "#[Route('/quotes/{id}', methods: ['GET'])]",
    "HttpKernel resolves the broker request, controller, arguments, and response.",
  ),
  "symfony-service-container": code(
    "php",
    "public function __construct(private CarrierGateway $carrierGateway) {}",
    "Autowiring supplies the carrier integration through its contract.",
  ),
  "symfony-backend-cheat-sheet": code(
    "php",
    "$bus->dispatch(new RequestCarrierQuote($quoteId, $carrierId));",
    "Messenger moves the carrier request to an idempotent asynchronous handler.",
  ),
  "javascript-event-loop": scenario(
    "A broker changes an answer while several carrier promises resolve. Microtasks process the promise callbacks before the browser's next rendering opportunity, so expensive quote work must not block the main thread.",
  ),
  "http-caching": scenario(
    "Carrier appetite metadata can use a short freshness lifetime plus an ETag; a submitted quote response must not be reused as shared public content.",
  ),
  cors: scenario(
    "The quoting UI may call only approved carrier origins. Each carrier API explicitly allows the brokerage origin, methods, and required authorization headers.",
  ),
  "web-storage": scenario(
    "Session storage may retain a non-sensitive quote-screen preference, but policyholder data and access tokens stay out of synchronous browser storage.",
  ),
  "browser-rendering-pipeline": scenario(
    "A broker filters thousands of quotes. Virtualization and transform-based row updates avoid repeated layout and paint across the full table.",
  ),
  "cookies-and-sessions": scenario(
    "The broker session uses a Secure, HttpOnly, SameSite cookie while server state holds identity and authorization context.",
  ),
  "frontend-trade-offs": scenario(
    "Keep fast quote-form validation on the client, but let the server own carrier eligibility and binding decisions because they require authoritative data and auditing.",
  ),
  "rest-api-design": scenario(
    "A broker retries `POST /quotes/{id}/bind` with an idempotency key; the API returns the same bound policy instead of creating a duplicate.",
  ),
  "authentication-authorization": scenario(
    "The session identifies the broker; authorization separately verifies that the broker can view the brokerage's quote and bind with the selected carrier.",
  ),
  "database-transactions": scenario(
    "Binding a quote creates the policy and records the selected carrier atomically. A serialization conflict retries the whole unit.",
  ),
  "database-indexes": scenario(
    "An index on `(brokerage_id, status, created_at)` supports the broker's active-quote screen while adding measured write and storage cost.",
  ),
  "server-caching": scenario(
    "Cache carrier appetite by carrier, product, region, and version. Invalidate it when underwriting rules publish and protect a cold key from a stampede.",
  ),
  "message-queues": scenario(
    "One job requests each carrier quote. Handlers are idempotent because delivery can repeat, and quote IDs provide correlation across retries.",
  ),
  "backend-observability": scenario(
    "A correlation ID follows one broker submission through the API, queue, carrier call, and policy response without logging sensitive application answers.",
  ),
  "array-traversal": scenario(
    "Scan carrier quotes once while tracking the lowest eligible premium. The invariant is that the current best is correct for every quote already visited.",
  ),
  "hash-map-lookup": scenario(
    "Index carrier quotes by carrier ID so a broker selection is found in average **O(1)** time instead of rescanning the quote list.",
  ),
  "two-pointers": scenario(
    "After sorting policy effective dates, move two pointers to find the closest non-overlapping coverage windows.",
  ),
  "sliding-window": scenario(
    "Maintain a window of carrier failures within the last five minutes instead of recounting the entire event history after every response.",
  ),
  "string-frequency": scenario(
    "Normalize a broker-entered policy identifier and compare character counts when validating an order-insensitive carrier checksum.",
  ),
  "binary-search": scenario(
    "Binary-search a carrier's ordered revenue bands to find the underwriting tier for the applicant's annual revenue.",
  ),
  "stack-and-queue": scenario(
    "Use a queue for carrier requests that must be processed in arrival order and a stack when validating nested policy-rule expressions.",
  ),
  "complexity-analysis": scenario(
    "For **n** carrier quotes, one ranking scan is **O(n)** time and **O(1)** auxiliary space; returning a new sorted list instead costs **O(n log n)** time.",
  ),
};

export function withSeedUsageExample(item: LibraryItemInput): LibraryItemInput {
  if (item.body.includes("## Usage example")) return item;
  const usage = usageBySlug[item.slug];
  if (!usage) return item;
  const lines = item.body.split("\n");
  const insertAt = lines.findIndex(
    (line, index) => index > 0 && line.startsWith("## "),
  );
  const position = insertAt < 0 ? lines.length : insertAt;
  lines.splice(position, 0, "## Usage example", "", usage, "");
  return { ...item, body: lines.join("\n") };
}
