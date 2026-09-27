const MAX_BRIEF_CHARACTERS = 480;

export function briefReply(content: string): {
  brief: string;
  folded: boolean;
} {
  const trimmed = content.trim();
  const paragraph = trimmed
    .split(/\n\s*\n/)
    .find(function prose(part) {
      return !/^(?:#{1,6}\s|```|[-*]\s|\d+\.\s)/.test(part.trim());
    })
    ?.trim();
  if (!paragraph)
    return { brief: "The agent's response is ready to review.", folded: true };
  const sentences = paragraph
    .split(/(?<=[.!?])\s+/)
    .slice(0, 3)
    .join(" ");
  let brief = sentences;
  if (brief.length > MAX_BRIEF_CHARACTERS) {
    const ending = brief.lastIndexOf(" ", MAX_BRIEF_CHARACTERS);
    brief = `${brief.slice(0, ending > 0 ? ending : MAX_BRIEF_CHARACTERS)}…`;
  }
  return { brief, folded: brief !== trimmed };
}
