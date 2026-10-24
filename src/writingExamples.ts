// Local illustrations of Text cleanup styles, never model requests or recordings.
export const writingExampleInput =
  "Um, let's meet Tuesday, actually Wednesday, around three to review CridVoice and the dryRun flag. Please don't set dryRun to false.";

const examples = {
  faithful:
    "Let’s meet Wednesday around three to review CridVoice and the dryRun flag. Please don’t set dryRun to false.",
  professional:
    "Let’s meet Wednesday around three to review CridVoice and the dryRun flag. Please do not set dryRun to false.",
  casual:
    "Let’s meet up Wednesday around three to review CridVoice and the dryRun flag. Please don’t set dryRun to false.",
  concise:
    "Meet Wednesday around three to review CridVoice and dryRun. Don’t set dryRun to false.",
  code: "Let’s meet Wednesday around three to review CridVoice and the dryRun flag.\nDo not set dryRun to false.",
} as const;

export function writingExample(style: string) {
  const chosen = Object.hasOwn(examples, style)
    ? (style as keyof typeof examples)
    : "faithful";
  return { input: writingExampleInput, output: examples[chosen] };
}
