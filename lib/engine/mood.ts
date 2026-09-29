// lib/engine/mood.ts
// Грубая презентационная категория настроения оппонента — только для UI (аватар/иконка).
// Сырые trust/interest наружу не отдаём (внутренности Engine), но их огрублённую интерпретацию
// показать можно — это ровно то же деление на диапазоны, что раньше было зашито внутри
// lib/llm/prompts.ts::buildOpponentReplyPrompt, вынесено сюда как единственный источник правды.
export type OpponentMood = "positive" | "neutral" | "negative";

const POSITIVE_TRUST_THRESHOLD = 65;
const NEGATIVE_TRUST_THRESHOLD = 30;

export function deriveOpponentMood(trust: number): OpponentMood {
  if (trust >= POSITIVE_TRUST_THRESHOLD) return "positive";
  if (trust <= NEGATIVE_TRUST_THRESHOLD) return "negative";
  return "neutral";
}
