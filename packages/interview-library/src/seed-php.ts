import type { LibraryItemInput } from "@omnitech/interview-contracts";

const verifiedAt = "2026-07-27";

function php(
  slug: string,
  title: string,
  summary: string,
  tags: string[],
  canonicalUrl: string,
  body: string,
): LibraryItemInput {
  return {
    slug,
    title,
    summary,
    body,
    contentType: "official-reference",
    collection: "php",
    tags: ["php", "php-8-4", ...tags],
    source: {
      publisher: "PHP Documentation Group",
      canonicalUrl,
      official: true,
      version: "8.4.x",
      lastVerifiedAt: verifiedAt,
    },
  };
}

export const phpLibrarySeed: LibraryItemInput[] = [
  php(
    "php-8-4",
    "PHP 8.4",
    "The PHP 8.4 features and compatibility changes worth discussing.",
    ["language", "migration"],
    "https://www.php.net/releases/8.4/en.php",
    `# PHP 8.4

## Headline features

PHP 8.4 adds property hooks, asymmetric property visibility, lazy objects,
\`#[\\Deprecated]\`, new DOM APIs, and \`BcMath\\Number\`.

## Array additions

\`array_find\`, \`array_find_key\`, \`array_any\`, and \`array_all\` make common
search and predicate operations explicit.

## Upgrade cautions

Implicitly nullable parameters are deprecated, several extensions moved to
PECL, invalid \`round()\` modes throw \`ValueError\`, and some legacy APIs are
deprecated or removed. Read the migration guide before upgrading production.`,
  ),
  php(
    "php-arrays",
    "PHP arrays",
    "Ordered maps used as lists, dictionaries, stacks, and queues.",
    ["arrays", "data-structures"],
    "https://www.php.net/manual/en/language.types.array.php",
    `# PHP arrays

## Mental model

A PHP array is an ordered map. Keys are integers or strings, insertion order is
preserved, and assigning a duplicate key replaces its value.

## Interview caveat

Arrays are flexible but have more memory overhead than packed specialized data
structures. Use \`array_is_list()\` when list shape matters and avoid repeated
\`array_shift()\` for large queues because it reindexes numeric keys.`,
  ),
  php(
    "php-array-map",
    "array_map",
    "Transform each array value with a callback.",
    ["arrays", "array-map", "functions"],
    "https://www.php.net/manual/en/function.array-map.php",
    `# array_map

## Usage example

\`\`\`php
$premiums = array_map(
    fn (array $quote): int => $quote['annualPremium'],
    $carrierQuotes,
);
\`\`\`

## Signature

\`array_map(?callable $callback, array $array, array ...$arrays): array\`

## Behavior

It returns a new array containing callback results. String keys are preserved
only when mapping one array; mapping multiple arrays produces sequential
integer keys.

## Interview use

Choose it for a one-to-one transformation. Use \`array_filter\` to remove
items and \`array_reduce\` to combine them.`,
  ),
  php(
    "php-array-filter",
    "array_filter",
    "Keep array entries accepted by a predicate.",
    ["arrays", "array-filter", "functions"],
    "https://www.php.net/manual/en/function.array-filter.php",
    `# array_filter

## Usage example

\`\`\`php
$eligibleQuotes = array_filter(
    $carrierQuotes,
    fn (array $quote): bool => $quote['status'] === 'eligible',
);
\`\`\`

## Signature

\`array_filter(array $array, ?callable $callback = null, int $mode = 0): array\`

## Behavior

Keys are preserved, so filtering a list may create gaps. Call
\`array_values()\` when the result must be a dense list.

## Interview caveat

With no callback, PHP removes values considered empty. Supply an explicit
predicate when \`0\`, \`"0"\`, or \`false\` may be valid domain values.`,
  ),
  php(
    "php-array-reduce",
    "array_reduce",
    "Fold an array into one accumulated value.",
    ["arrays", "array-reduce", "functions"],
    "https://www.php.net/manual/en/function.array-reduce.php",
    `# array_reduce

## Usage example

\`\`\`php
$lowestPremium = array_reduce(
    $carrierQuotes,
    fn (?int $lowest, array $quote): int =>
        min($lowest ?? PHP_INT_MAX, $quote['annualPremium']),
    null,
);
\`\`\`

## Signature

\`array_reduce(array $array, callable $callback, mixed $initial = null): mixed\`

## Use it for

Build totals, lookup maps, grouped results, or another single accumulator.

## Interview caveat

Make the initial accumulator type explicit. A readable loop is often clearer
when the reducer needs several branches, early termination, or mutation-heavy
work.`,
  ),
  php(
    "php-array-find",
    "array_find",
    "Return the first value accepted by a callback in PHP 8.4.",
    ["arrays", "array-find", "functions"],
    "https://www.php.net/manual/en/function.array-find.php",
    `# array_find

## Usage example

\`\`\`php
$boundQuote = array_find(
    $carrierQuotes,
    fn (array $quote): bool => $quote['status'] === 'bound',
);
\`\`\`

## Signature

\`array_find(array $array, callable $callback): mixed\`

## Behavior

It returns the first matching value or \`null\` when none matches.
\`array_find_key()\` returns the matching key instead.

## Related PHP 8.4 APIs

\`array_any()\` answers whether at least one value matches, while
\`array_all()\` requires every value to match.`,
  ),
  php(
    "php-strings",
    "PHP strings",
    "Byte-oriented strings, interpolation, comparison, and Unicode boundaries.",
    ["strings", "types"],
    "https://www.php.net/manual/en/language.types.string.php",
    `# PHP strings

## Representation

A PHP string is a sequence of bytes. Double-quoted strings interpolate
variables and escapes; single-quoted strings perform minimal interpolation.

## Common APIs

Use \`str_contains\`, \`str_starts_with\`, \`str_ends_with\`, \`explode\`,
\`implode\`, \`substr\`, and \`strlen\` for byte-oriented work.

## Unicode caveat

\`strlen\` and \`substr\` operate on bytes. Use the mbstring or intl extension
when code points, graphemes, or locale-aware comparison matter.`,
  ),
  php(
    "php-preg-match",
    "preg_match",
    "Match a PCRE regular expression against a string.",
    ["strings", "regex", "preg-match"],
    "https://www.php.net/manual/en/function.preg-match.php",
    `# preg_match

## Usage example

\`\`\`php
$isPolicyNumber = preg_match(
    '/^[A-Z]{3}-\\d{8}$/',
    $carrierPolicyNumber,
) === 1;
\`\`\`

## Signature

\`preg_match(string $pattern, string $subject, array &$matches = null, int $flags = 0, int $offset = 0): int|false\`

## Return value

It returns \`1\` for a match, \`0\` for no match, and \`false\` for an error.
Use strict comparison so an error is not confused with no match.

## Safety

Avoid catastrophic backtracking with untrusted input, escape literal fragments
using \`preg_quote\`, and inspect \`preg_last_error_msg()\` on failure.`,
  ),
  php(
    "php-types",
    "PHP type declarations",
    "Scalar, union, intersection, nullable, literal, and return types.",
    ["types", "type-system"],
    "https://www.php.net/manual/en/language.types.declarations.php",
    `# Type declarations

## Available forms

PHP supports class and interface types, scalar types, \`array\`, \`callable\`,
\`iterable\`, \`object\`, union types, intersection types, DNF types, and
literal \`true\`, \`false\`, and \`null\`.

## PHP 8.4 boundary

Write nullable parameters explicitly as \`?Type\` or \`Type|null\`. Relying on
a \`null\` default to imply nullability is deprecated.

## Interview practice

Use the narrowest honest boundary and let static analysis refine shapes that
the runtime type system cannot express.`,
  ),
  php(
    "php-classes-objects",
    "PHP classes and objects",
    "Visibility, inheritance, traits, interfaces, and object composition.",
    ["oop", "classes", "objects"],
    "https://www.php.net/manual/en/language.oop5.php",
    `# Classes and objects

## Design tools

Interfaces define substitutable contracts, abstract classes share partial
implementation, and traits reuse methods without inheritance.

## PHP 8.4 properties

Asymmetric visibility can expose public reads with restricted writes, while
property hooks define focused \`get\` and \`set\` behavior.

## Interview preference

Favor composition and constructor-injected dependencies. Keep entities focused
on domain invariants instead of using inheritance as a general reuse tool.`,
  ),
  php(
    "php-exceptions",
    "PHP exceptions",
    "Throw, catch, chain, and clean up failures predictably.",
    ["exceptions", "errors", "safety"],
    "https://www.php.net/manual/en/language.exceptions.php",
    `# Exceptions

## Flow

Throw domain-specific exceptions when a function cannot fulfill its contract.
Catch only where the program can add context, recover, translate, or terminate
cleanly.

## Throwable

Both \`Exception\` and engine \`Error\` implement \`Throwable\`. Use
\`finally\` for cleanup and exception chaining to preserve the original cause.

## Interview caveat

Do not swallow failures or use exceptions for ordinary branching. Convert
exceptions to safe HTTP responses at the application boundary.`,
  ),
  php(
    "php-pdo",
    "PDO",
    "Database access with prepared statements and explicit transactions.",
    ["database", "pdo", "security"],
    "https://www.php.net/manual/en/book.pdo.php",
    `# PDO

## Prepared statements

Prepare SQL with placeholders and bind values separately. Parameters protect
values, not identifiers such as table names or sort directions; allowlist
those explicitly.

## Transactions

Use \`beginTransaction()\`, \`commit()\`, and \`rollBack()\` around one atomic
unit. Keep transactions short and understand the database isolation level.

## PHP 8.4

Driver-specific PDO subclasses expose capabilities without calling methods
that do not exist for the active driver.`,
  ),
  php(
    "php-generators",
    "PHP generators",
    "Produce iterable values lazily with yield.",
    ["generators", "iterators", "memory"],
    "https://www.php.net/manual/en/language.generators.php",
    `# Generators

## Syntax

A function containing \`yield\` returns a \`Generator\`. Values are produced as
the caller iterates rather than collected into one array first.

## Use it for

Stream large files, database batches, pipelines, or calculated sequences with
bounded memory.

## Interview caveat

Generators are generally single-pass. Do not promise random access, count, or
rewind behavior unless the specific iterator supports it.`,
  ),
  php(
    "php-enumerations",
    "PHP enumerations",
    "Model a closed set of valid cases with optional scalar backing values.",
    ["enums", "types", "domain-modeling"],
    "https://www.php.net/manual/en/language.enumerations.php",
    `# Enumerations

## Forms

Pure enums define named cases. Backed enums associate each case with a unique
\`string\` or \`int\` and provide \`from()\` and \`tryFrom()\`.

## Use it for

Represent domain states, roles, modes, or categories that must remain within a
closed set.

## Interview caveat

Persist stable backing values rather than case order. Put behavior on the enum
when it is intrinsic to the domain value.`,
  ),
];
