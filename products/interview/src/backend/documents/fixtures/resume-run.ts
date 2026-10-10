// The real resume run of 2026-10-10, kept as a fixture (see
// bionic/briefs/BRIEF-document-generation-quality-and-ai-logging.md). The
// matrix is synthetic: it has the shape of the owner's (a current employer, a
// consultancy with FIVE client contracts for a template with FOUR contract
// blocks, a prior employer, earlier roles, one of them with no dates) and
// invented names and figures, no real personal data. The posting is the text
// the run was written for. The DOCX has the real template's structure: one
// paragraph of several runs with its values separated by "|" or "~", list
// items that are "Label: {value}", and a consultancy block with client
// sub-blocks.
import {
  type DocumentField,
  withFieldGroups,
} from "@omnitech/interview-contracts";
import JSZip from "jszip";

export const FULLSTACK_POSTING = `FullStack is an AI-native engineering partner (600+ customers in North America). Join its talent network for flexible, project-based work with U.S. clients as a Principal Full Stack Engineer (React & AI-Driven). You integrate directly into the client's team and work with their designers and engineers daily. 100% remote.

Required
- 8+ years of professional software engineering, designing and building scalable full-stack applications
- Deep expertise in modern front-end development with React and TypeScript
- 1-3 years of professional experience with AI-assisted engineering workflows and agentic AI tools (Cursor, Claude Code, Copilot) to accelerate delivery
- Proven track record leading complex technical initiatives across multiple teams and writing clear architectural design documents (RFCs, ADRs)
- Strong back-end background with hands-on production experience in GraphQL or Ruby on Rails
- Demonstrated experience mentoring senior engineers, driving technical best practices, and evaluating trade-offs for org-wide initiatives
- Ability to work through new and difficult issues and contribute to libraries as needed
- Ability to create and maintain continuous integration and delivery of applications
- Meaningful experience on large, complex systems
- Experience on Agile / Scrum teams
- Forensic attention to detail; extreme ownership of your work
- Ability to identify with the client's goals and deliver on the team's commitments
- Advanced English; a four-year college degree

Strong plus
- Mobile development: React Native, iOS or Android
- AI-enthusiastic in daily workflow: Cursor, Windsurf or Google Antigravity; Claude Code, Gemini CLI, Codex or Copilot CLI

Work authorization: must be authorized to work in the country of the posting; no visa sponsorship.`;

const role = (
  company: string,
  title: string,
  period: string | undefined,
  detail: {
    technologies: string[];
    metrics?: Array<{ label: string; value: string }>;
    proof_points: string[];
    engaged_through?: string;
  },
) => ({
  company,
  title,
  ...(period === undefined ? {} : { period }),
  technologies: detail.technologies,
  metrics: detail.metrics ?? [],
  proof_points: detail.proof_points,
  ...(detail.engaged_through
    ? { engaged_through: detail.engaged_through }
    : {}),
});

const CONSULTANCY = "Larkspur Works";

// Role pointers, by the order below: /roles/0 Northbeam (current),
// /roles/1 Tidewater, /roles/2 Plotline, /roles/3 Fleetmark, /roles/4
// Backerly, /roles/5 Signalpath (the five clients), /roles/6 Ostrava (prior),
// /roles/7 Meridian Hours, /roles/8 Quillon Networks, /roles/9 Harrow & Finch
// (no dates).
export const SYNTHETIC_MATRIX = {
  candidate: {
    name: "Rowan Ashby",
    headline: "Staff-level full-stack engineer and architect",
    location: "Calgary, AB",
  },
  contracting_companies: [
    {
      company: CONSULTANCY,
      title: "Lead Full Stack Developer / Architect / Contractor",
      period: "July 2020 – September 2024",
      from: "July 2020",
      to: "September 2024",
      clients: [
        "Tidewater Learning",
        "Plotline",
        "Fleetmark",
        "Backerly",
        "Signalpath",
      ],
    },
  ],
  roles: [
    role(
      "Northbeam Payments",
      "Senior Software Developer / Architect",
      "2024–Present",
      {
        technologies: ["Laravel", "Vue.js", "OpenAPI", "MySQL"],
        metrics: [{ label: "scaffolding reduction", value: "80%" }],
        proof_points: ["Reduced release cycles from weeks to hours"],
      },
    ),
    role("Tidewater Learning", "Lead Software Developer / Architect", "2023", {
      technologies: ["Ruby on Rails", "React", "GraphQL", "PostgreSQL"],
      metrics: [{ label: "integration time", value: "6 weeks" }],
      proof_points: [
        "Integrated Tidewater Learning into the Compass platform after the acquisition",
      ],
      engaged_through: CONSULTANCY,
    }),
    role("Plotline", "Senior Software Developer / Architect", "2022", {
      technologies: ["React", "TypeScript", "Node.js"],
      metrics: [{ label: "listing search latency", value: "45ms" }],
      proof_points: ["Rebuilt listing search for commercial property"],
      engaged_through: CONSULTANCY,
    }),
    role("Fleetmark", "Senior Software Developer / Architect", "2021–2022", {
      technologies: ["Ruby on Rails", "Kafka", "PostGIS"],
      metrics: [{ label: "tracked assets", value: "2.1M" }],
      proof_points: ["Scaled asset tracking ingestion"],
      engaged_through: CONSULTANCY,
    }),
    role("Backerly", "Senior Software Developer / Architect", "2021", {
      technologies: ["Elixir", "Phoenix"],
      proof_points: ["Built referral payouts for crowdfunding campaigns"],
      engaged_through: CONSULTANCY,
    }),
    role(
      "Signalpath",
      "Lead Senior Software Developer / Architect",
      "2020–2021",
      {
        technologies: ["React", "GraphQL", "Ruby on Rails"],
        metrics: [{ label: "onboarding time", value: "30%" }],
        proof_points: ["Led the insurance quoting platform rebuild"],
        engaged_through: CONSULTANCY,
      },
    ),
    role(
      "Ostrava Insurance Tech",
      "Lead Senior Software Developer / Architect",
      "2018–2020",
      {
        technologies: ["Angular", "NestJS", "AWS"],
        metrics: [{ label: "quote conversion", value: "22%" }],
        proof_points: ["Launched the broker self-service portal"],
      },
    ),
    role("Meridian Hours", "Senior Software Architect", "2017–2018", {
      technologies: ["Ruby on Rails", "Redis"],
      proof_points: ["Re-architected time tracking sync"],
    }),
    role("Quillon Networks", "Senior Software Developer", "2014–2017", {
      technologies: ["Java", "Spring"],
      proof_points: ["Shipped the device provisioning service"],
    }),
    role("Harrow & Finch", "Software Developer", undefined, {
      technologies: ["PHP"],
      proof_points: ["Built agency campaign sites"],
    }),
  ],
};

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const run = (text: string) =>
  `<w:r><w:t xml:space="preserve">${text.replaceAll("&", "&amp;")}</w:t></w:r>`;
// A paragraph of several runs; a placeholder may be split across runs, as
// Word splits them in the real file.
const line = (runs: string[], options: { list?: boolean } = {}) =>
  `<w:p>${options.list ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : ""}${runs
    .map(run)
    .join("")}</w:p>`;
const heading = (text: string) =>
  `<w:p><w:pPr><w:rPr><w:caps/></w:rPr></w:pPr>${run(text)}</w:p>`;
const bullets = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    line([`{${prefix}${index + 1}}`], { list: true }),
  );

const BODY = [
  line(["{headingName}"]),
  line(["{headingRole}"]),
  // The contact line: values in their own runs, a placeholder split in two,
  // and each "|" a run of template text.
  line([
    " ",
    "{headingPhone",
    "Number}",
    "   |    ",
    "{emailAddress}",
    "   |    ",
    "{portfolio}",
    "   |    ",
    "{city}",
    ", ",
    "{province}",
  ]),
  heading("Professional Summary"),
  line(["{summaryParagraph1}"]),
  line(["{summaryParagraph2}"]),
  heading("Core Skills"),
  line(["Architecture: ", "{architectureSkills}"], { list: true }),
  line(["Leadership: ", "{leadershipSkills}"], { list: true }),
  line(["Frontend: ", "{frontendSkills}"], { list: true }),
  heading("Professional Experience"),
  line([
    "{currentCompany}",
    " ~ ",
    "{currentRole}",
    " ~ ",
    "{currentFrom}",
    " – Present",
  ]),
  ...bullets("currentExperienceBullet", 2),
  line(["Acquired Skills (", "{currentAcquiredSkill}", ")"]),
  line([
    "{myCompanyName}",
    " ~ ",
    "{myCompanyRole}",
    " (",
    "{myCompanyFrom}",
    "- ",
    "{myCompanyTo}",
    ")",
  ]),
  ...[1, 2, 3, 4].flatMap((slot) => [
    line([`{contractCompany${slot}}`, " (", `{contractRole${slot}}`, "): "]),
    ...bullets(`contract${slot}Bullet`, 2),
  ]),
  line(["Acquired Skills (", "{contractsAcquiredSkills}", ")"]),
  line([
    "{priorMyCompany1}",
    " ~ ",
    "{priorMyCompany1Role}",
    " ~ ",
    "{priorMyCompany1From}",
    " – ",
    "{priorMyCompany1To}",
  ]),
  ...bullets("priorMyCompany1Bullet", 2),
  line([
    "Earlier Experience (",
    "{earlierExpFrom}",
    " – ",
    "{earlierExpTo}",
    ")",
  ]),
  ...bullets("earlierExpBullet", 2),
  heading("Achievements And Interests"),
  line(["{achievementsAndInterests}"]),
].join("");

/** The resume template, with the real file's paragraph and run structure. */
export async function resumeRunDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />',
  );
  zip.file(
    "word/document.xml",
    `<w:document ${W}><w:body>${BODY}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// The template's fields in template order, as intake derives them.
const KEYS = [
  "heading_name",
  "heading_role",
  "heading_phone_number",
  "email_address",
  "portfolio",
  "city",
  "province",
  "summary_paragraph1",
  "summary_paragraph2",
  "architecture_skills",
  "leadership_skills",
  "frontend_skills",
  "current_company",
  "current_role",
  "current_from",
  "current_experience_bullet1",
  "current_experience_bullet2",
  "current_acquired_skill",
  "my_company_name",
  "my_company_role",
  "my_company_from",
  "my_company_to",
  ...[1, 2, 3, 4].flatMap((slot) => [
    `contract_company${slot}`,
    `contract_role${slot}`,
    `contract${slot}_bullet1`,
    `contract${slot}_bullet2`,
  ]),
  "contracts_acquired_skills",
  "prior_my_company1",
  "prior_my_company1_role",
  "prior_my_company1_from",
  "prior_my_company1_to",
  "prior_my_company1_bullet1",
  "prior_my_company1_bullet2",
  "earlier_exp_from",
  "earlier_exp_to",
  "earlier_exp_bullet1",
  "earlier_exp_bullet2",
  "achievements_and_interests",
];

/** The fixture template's fields, each with the block its key names. */
export function resumeRunFields(): DocumentField[] {
  return withFieldGroups(
    KEYS.map((key) => ({
      key,
      label: key.replaceAll("_", " "),
      source: "candidate-profile" as const,
      required: true,
      maxLength: null,
    })),
  );
}
