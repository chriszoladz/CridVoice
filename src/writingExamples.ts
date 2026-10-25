import type { RewriteStrength } from "./types";

// Local illustrations only, never model requests or recordings.
export const writingExampleInput =
  "Um, quick update on the release. The sign-in fix in auth.ts is ready, but I haven't tested mobile yet. And for the review, Friday, actually Thursday, around two. I'm not promising we can ship then. Also, we still need Maya's approval.";

export const rewriteStrengths = [
  {
    value: "light",
    name: "Light",
    label: "Light · grammar & punctuation",
    description:
      "Fix grammar and punctuation with minimal changes to your wording.",
  },
  {
    value: "balanced",
    name: "Balanced",
    label: "Balanced · smoother wording",
    description:
      "Smooth rough sentences and rephrase when it makes your meaning clearer.",
  },
  {
    value: "thorough",
    name: "Thorough",
    label: "Thorough · organize my thoughts",
    description:
      "Rephrase and group a spoken brain dump into clear, readable paragraphs.",
  },
] satisfies {
  value: RewriteStrength;
  name: string;
  label: string;
  description: string;
}[];

const styleDescriptions = {
  faithful: "Keep your natural voice and everyday wording.",
  professional: "Use polished, work-ready phrasing.",
  casual: "Use relaxed, conversational phrasing and contractions.",
  concise: "Use fewer words while keeping every point and qualification.",
  code: "Write prose while preserving exact code terms and identifiers.",
};

export function writingStyleDescription(style: string) {
  return styleDescriptions[
    Object.hasOwn(styleDescriptions, style)
      ? (style as keyof typeof styleDescriptions)
      : "faithful"
  ];
}

const examples = {
  light: {
    faithful:
      "Quick update on the release. The sign-in fix in auth.ts is ready, but I haven’t tested mobile yet. The review is Thursday around two. I’m not promising we can ship then. We still need Maya’s approval.",
    professional:
      "A quick release update: the sign-in fix in auth.ts is ready, but I have not tested mobile yet. The review is Thursday around two. I am not promising we can ship then. We still need Maya’s approval.",
    casual:
      "Quick release update: the sign-in fix in auth.ts is ready, but I haven’t tested mobile yet. The review’s Thursday around two. I’m not promising we can ship then, and we still need Maya’s approval.",
    concise:
      "Release update: sign-in fix in auth.ts ready; I haven’t tested mobile yet. Review Thursday around two. I’m not promising we can ship then; Maya’s approval still needed.",
    code: "The sign-in fix in auth.ts is ready, but I have not tested mobile yet. The release review is Thursday around two. I am not promising we can ship then. Maya’s approval is still needed.",
  },
  balanced: {
    faithful:
      "The sign-in fix in auth.ts is ready, but I haven’t tested mobile yet. The release review is Thursday around two.\n\nI’m not promising we can ship then. We still need Maya’s approval.",
    professional:
      "The sign-in fix in auth.ts is ready, although I have not tested mobile yet. The release review is Thursday around two.\n\nI am not committing to shipping then; Maya’s approval is still needed.",
    casual:
      "The sign-in fix in auth.ts is ready, but I haven’t tried it on mobile yet. We’re reviewing the release Thursday around two.\n\nI’m not promising we can ship then, and we still need Maya’s approval.",
    concise:
      "Sign-in fix in auth.ts ready; I haven’t tested mobile yet. Release review Thursday around two.\n\nI’m not promising we can ship then. Maya’s approval still needed.",
    code: "The sign-in fix in auth.ts is ready; I have not tested mobile yet. The release review is Thursday around two.\n\nI am not promising we can ship then. Maya’s approval is still needed.",
  },
  thorough: {
    faithful:
      "The sign-in fix in auth.ts is ready, but I haven’t tested mobile yet.\n\nThe release review is Thursday around two.\n\nI’m not promising we can ship then. We still need Maya’s approval.",
    professional:
      "The sign-in fix in auth.ts is ready, although I have not tested mobile yet.\n\nThe release review is Thursday around two.\n\nI am not committing to shipping then. Maya’s approval is still needed.",
    casual:
      "The sign-in fix in auth.ts is ready. I haven’t tested mobile yet, though.\n\nThe release review’s Thursday around two.\n\nI’m not promising we can ship then. We still need Maya’s approval.",
    concise:
      "Sign-in fix in auth.ts ready; I haven’t tested mobile yet.\n\nRelease review Thursday around two.\n\nI’m not promising we can ship then. Maya’s approval still needed.",
    code: "The sign-in fix in auth.ts is ready; I have not tested mobile yet.\n\nThe release review is Thursday around two.\n\nI am not promising we can ship then. Maya’s approval is still needed.",
  },
} satisfies Record<RewriteStrength, Record<string, string>>;

export function writingExample(style: string, strength: string = "balanced") {
  const chosenStrength = Object.hasOwn(examples, strength)
    ? (strength as RewriteStrength)
    : "balanced";
  const chosenStyle = Object.hasOwn(examples[chosenStrength], style)
    ? (style as keyof typeof examples.balanced)
    : "faithful";
  return {
    input: writingExampleInput,
    output: examples[chosenStrength][chosenStyle],
  };
}
