import type { AnswerGuide } from "@omnitech/interview-contracts";

export type InterviewLanguage = "php" | "react" | "typescript" | "ruby";
export type InterviewLanguageSelection = InterviewLanguage | "auto";

export interface GeneratedInterviewAnswer {
  answerMarkdown: string;
  code: string;
  language: InterviewLanguage;
  testCode: string;
  title: string;
  usageCode: string;
  // The structured guide the Workspace stages show; answerMarkdown is
  // rendered from it.
  guide?: AnswerGuide | undefined;
}

export interface SavedInterviewAnswer extends GeneratedInterviewAnswer {
  createdAt: string;
  id: string;
  notes: string;
  question: string;
  updatedAt: string;
}

export interface GeneratedInterviewExplanation {
  markdown: string;
  title: string;
}

export interface SavedInterviewExplanation
  extends GeneratedInterviewExplanation {
  createdAt: string;
  id: string;
  topic: string;
  updatedAt: string;
}

export interface InterviewRouteResult {
  confidence: number;
  language: InterviewLanguage;
  reasons: string[];
}

export interface InterviewRunResult {
  durationMs: number;
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

export interface InterviewAnswersClient {
  deleteAnswer(id: string): Promise<void>;
  generate(input: {
    language?: InterviewLanguageSelection | undefined;
    providerId?: string | undefined;
    question: string;
  }): Promise<GeneratedInterviewAnswer>;
  explain(input: {
    context?: string | undefined;
    providerId?: string | undefined;
    topic: string;
  }): Promise<GeneratedInterviewExplanation>;
  getAnswer(id: string): Promise<SavedInterviewAnswer>;
  health(): Promise<{ ok: boolean; providers: unknown[] }>;
  listAnswers(): Promise<SavedInterviewAnswer[]>;
  listExplanations(): Promise<SavedInterviewExplanation[]>;
  route(input: {
    language?: InterviewLanguageSelection | undefined;
    question: string;
  }): Promise<InterviewRouteResult>;
  run(input: {
    code: string;
    language: Exclude<InterviewLanguage, "react">;
    stdin?: string | undefined;
  }): Promise<InterviewRunResult>;
  saveAnswer(
    input: GeneratedInterviewAnswer & {
      id?: string | undefined;
      notes?: string | undefined;
      question: string;
    },
  ): Promise<SavedInterviewAnswer>;
  saveExplanation(
    input: GeneratedInterviewExplanation & {
      id?: string | undefined;
      topic: string;
    },
  ): Promise<SavedInterviewExplanation>;
}
