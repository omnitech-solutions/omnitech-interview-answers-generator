# products/interview/src/backend/documents/verify.ts

_Source: `products/interview/src/backend/documents/verify.ts` (header-comment fallback)_

[SAFETY] What the model wrote is checked in code against the person's own
record, as the coach's notes are (`coach/reply.ts`), never by the model
saying so. For a field tied to a role, every figure and every proper noun in
its text must occur in that role's entry in the experience matrix; a field
tied to no role (a summary, a skills line) is checked against the whole
matrix. What is not found is recorded on the field.

The normalisations, all applied to both the text and the evidence:
- case and accents are ignored; punctuation inside a name is ignored
("Node.js" = "NodeJS" = "node js");
- a trailing "js" and a plural "s" are ignored ("React" = "React.js",
"APIs" = "API");
- a hyphen or slash joins or splits ("micro-frontends" = "microfrontends",
"CI/CD" is "CI" and "CD");
- a figure keeps its unit: "40%" = "40 percent", "45ms" = "45 ms",
"6h" = "6 hours", "50min" = "50 minutes", "8+ years" = "8 yrs",
"2.1M" = "2.1 million" = "2,100,000", "$3k" = "3000"; "10+" = "10",
"8.x" = "8"; a bare number matches only the same bare number;
- what the matrix says about a role outside its entry (a leadership
signal's evidence that names the employer) counts as that role's.
