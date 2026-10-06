import type { DocumentTemplateKind } from "@omnitech/interview-contracts";
import { type BrevitySettings, DEFAULT_DOCUMENTS_CONFIG } from "./config";

export type BuiltInKey = "resume" | "cover-letter" | "interview-prep";

export type BuiltInTemplate = {
  key: BuiltInKey;
  name: string;
  kind: DocumentTemplateKind;
  format: "docx" | "md";
  // The committed stand-in file, and the name the author's real one has in a
  // local templates directory (which is never committed: it holds contact
  // details).
  asset: string;
  localFile: string;
  instructions: string;
};

/** The built-in templates, their instructions asking for as much as `brevity` allows. */
export function builtInTemplates(
  brevity: BrevitySettings = DEFAULT_DOCUMENTS_CONFIG.brevity,
): readonly BuiltInTemplate[] {
  return [
    {
      key: "resume",
      name: "Resume",
      kind: "resume",
      format: "docx",
      asset: "resume.docx",
      localFile: "resume.template.docx",
      instructions: [
        "Write a professional resume from the candidate's experience matrix. Every claim needs a named company, a named system or project, a named technology and a metric where the matrix has one.",
        "Never invent roles, companies, systems, technologies or metrics. Prefer the strongest match to the role over recency. If the matrix has no evidence for a field, leave it empty.",
        "Tone: spoken and professional, concrete and impactful rather than analytical. Experience bullets are complete, action-oriented sentences showing impact, technical depth and leadership. Skills fields are comma-separated lists ordered by relevance and must reflect technologies proven in the experience sections.",
        "Summary paragraphs hook the reader with top achievements and core expertise. Achievements and interests are short, genuine and human.",
        "Location: the city field holds the city only and the region field holds the province or state only, as its standard two-letter abbreviation (for example AB); never repeat the city in the region.",
        "A strength is a short label of two to five words, never a sentence.",
        `Be brief: a bullet is one sentence of at most ${brevity.fieldWords} words, a summary paragraph at most ${brevity.summaryWords} words, a skills line at most ${brevity.skillItems} items. Shorter and specific beats long and general.`,
      ].join("\n\n"),
    },
    {
      key: "cover-letter",
      name: "Cover letter",
      kind: "cover_letter",
      format: "docx",
      asset: "cover-letter.docx",
      localFile: "cover-letter.template.docx",
      instructions: [
        "Write a cover letter's fields, tailored to the target company and role in the application and its job description. Every claim needs a named company, system or project, technology and metric where the matrix has one.",
        "Never invent roles, companies, systems, technologies or metrics. Prefer the experience that best matches the company's problems over recency.",
        'Most fields are slots inside a sentence of the letter (for example "I specialize in {capabilityCluster}, using {techStack}"). Write each as a short phrase, usually under twelve words, that reads naturally in place: no parenthetical lists, no repeated company names, no trailing punctuation. Name one project, company and measurable outcome where a slot asks for one.',
        "Tone: spoken, persuasive and specific. Show you understand their context, connect your experience to their challenges with concrete examples and measurable outcomes, and close with a clear value proposition.",
      ].join("\n\n"),
    },
    {
      key: "interview-prep",
      name: "Interview prep",
      kind: "interview_prep",
      format: "md",
      asset: "interview-prep.md",
      localFile: "interview-prep.template.md",
      instructions: [
        "Answer: what does this interviewer most need to hear, with exact proof? Use the job description and the interview stage in the application.",
        "Every claim needs a named company, system, technology and metric where the matrix has one. Never invent them. Prefer the strongest match: direct stack, then domain, then adjacent. Write all fields as spoken-answer strings, concrete rather than analytical.",
        "Mapping fields are evaluation themes such as ownership or trade-off reasoning, never technology names. Questions to ask refer to the company only.",
        `Be brief, because this is read aloud: every field is one spoken sentence of at most ${brevity.fieldWords} words, and list items and mappings at most ${brevity.listItemWords}. Do not repeat a story already used elsewhere in the same section.`,
        "Adapt to the stage. Recruiter screen: fit, clarity and motivation, short plain bullets. Hiring manager: ownership, delivery and metrics, as system then outcome then metric. Head of engineering: architecture, trade-offs and autonomy, as need then system then technology then metric. Technical or system design: depth, scalability and interfaces, as problem then model then trade-offs then evolution. Coding or pairing: implementation clarity, stepwise. Behavioural or final: culture, leadership and consistency, as story then outcome then learning.",
      ].join("\n\n"),
    },
  ];
}
