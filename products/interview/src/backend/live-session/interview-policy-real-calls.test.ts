// The question gate on the way a real recruiter screen sounds. Every line is a
// paraphrase of one the interviewer said in a recorded screen (names and companies
// removed): real questions arrive wrapped in preamble, often with no question mark
// ("I'd love to hear..."), while greetings and audio checks DO carry question marks.
// What opens a task costs a model call and puts a card in front of the candidate, so
// the gate must open for the first kind and stay shut for the second.
import { describe, expect, it } from "vitest";
import { decideBaseline } from "./interview-policy";

const decide = (text: string) =>
  decideBaseline({
    utterance: {
      id: "u1",
      speaker: "interviewer",
      source: "application-audio",
      segmentIds: ["u1"],
      startMs: 0,
      endMs: 1,
      text,
    },
    openTasks: [],
    deferredTopics: [],
  }).decision.kind;

const REAL_QUESTIONS = [
  "Yeah, just to kind of start things off, I'd love to hear what, uh, interested you in applying for this career opportunity.",
  "It's a bit tricky, because I'm sure the answer can vary depending on circumstances, but to the best of your ability, I'd love to see how you might estimate how you currently split your time between those responsibilities.",
  "All right, lovely. And then my next question for you is more of a storytelling opportunity. And so I'd love to hear if maybe you can walk me through a project that you're really proud of, the one that comes to mind.",
  "Be sure to include the goals and maybe challenges. What was the tech stack that you used, whom you collaborated with? And ultimately, what was your role in making it successful?",
  "Ideally AWS and NestJS too. Are those technologies that you're familiar with?",
  "Okay, lovely. And then my next question for you now is regarding best practices, and that's why I was intrigued when you mentioned observability and security. I'd love to hear if those are things you've considered before.",
  "Alright, and so this one, I'd love to hear if, um, you can describe to me a microservice that you had personally designed or owned, and what were some of its boundaries and failure modes.",
  "My next question for you now is regarding your timeline. If we were to give you an offer for this position, did you have any particular start dates in mind?",
  "Fantastic. Easy enough for us to take into account. And now I'd love to ask a bit more about what might be motivating your current search for a new position.",
  "What made you switch from your previous company to the next one?",
  "Alright, and my last question for you now is just regarding compensation, but rest assured that this is very preliminary. I'd love to ask if you had any preferences as to what type of compensation.",
  "Do you have any kind of more specific ranges within that that you're hoping for?",
  "Did you have any other questions for me for now?",
  // Text written without spaces is long, not one short word.
  "請問你能描述一下你如何設計這個系統的容錯機制嗎？ ?",
];

const NOT_QUESTIONS = [
  "Hey, Desmond, how's it going?",
  "Yeah, and uh yes, I can hear you alright. How about me, like, does everything sound okay on your end?",
  "Can you hear me okay?",
  "Is this a good time to talk?",
  "Perfect.",
  "Mm-hmm.",
  "Oh, lovely, huh?",
  "Alright, fantastic. And so, as you know, this is for the tech lead position, and this person will be joining what we call our core group, which owns the documents generation process, the renewals process and the pricing and quoting process, and they use the MERN stack.",
  "Um, I'm just going through my questions now, because we've actually covered a lot of what I wanted to ask, so I'm just skipping over a couple of these.",
  "Yeah, I completely agree, and also somebody who had zero insurance experience before this one, I was also really impressed by how much I actually learned.",
  "That's really great to hear. Sorry, I'm just finishing up my notes surrounding this, but that was a really great description.",
  "Sorry, I'm just making a note not to forget to follow up.",
  "Okay, fantastic. Let me take note.",
  "Understood?",
  "Agreed?",
  "Um, and yeah, that's the super quick overview. Do you have any questions at all about what I've discussed so far before I continue?",
];

describe("the question gate, on how a recruiter screen really sounds", () => {
  it.each(REAL_QUESTIONS)("opens a task for: %s", (text) => {
    expect(decide(text)).toBe("open");
  });

  it.each(NOT_QUESTIONS)("opens nothing for: %s", (text) => {
    expect(decide(text)).not.toBe("open");
  });
});
