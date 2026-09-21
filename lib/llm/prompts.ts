// lib/llm/prompts.ts
// Заготовка промптов: роль оппонента, промпт-судья (оценка реплики + ответ оппонента)
// и промпт итогового фидбека по завершённой сессии.
// Все промпты параметризуются данными Scenario из Prisma.

import type { Scenario } from "@prisma/client";

export type JudgeResult = {
  score: number;
  criteria: {
    argumentation: number;
    interests: number;
    tone: number;
  };
  comment: string;
  opponentReply: string;
  isEnding: boolean;
  endingOutcome?: "deal" | "no_deal" | "partial" | null;
};

export type FeedbackResult = {
  summary: string;
  strengths: string;
  improvements: string;
  overallScore: number;
};

const DIFFICULTY_NOTE: Record<Scenario["difficulty"], string> = {
  EASY: "Ты довольно легко идёшь на уступки, если аргумент хоть немного обоснован.",
  MEDIUM: "Ты уступаешь только в ответ на весомые аргументы, торгуешься за условия.",
  HARD: "Ты держишь позицию жёстко, уступаешь редко и только при очень сильной аргументации, можешь давить и проверять оппонента на прочность.",
};

export function buildOpponentSystemPrompt(scenario: Scenario): string {
  return `Ты играешь роль участника переговоров в тренажёре "Арена переговоров".

Контекст: ${scenario.domain}.
Твоя роль: ${scenario.opponentRole}.
Твои цели в переговорах: ${scenario.opponentGoals}.
Тон общения: ${scenario.opponentTone}.
Сложность: ${DIFFICULTY_NOTE[scenario.difficulty]}

Правила:
- Оставайся в рамках роли и целей на протяжении всего диалога, не соглашайся на условия, противоречащие твоим целям, без веской причины.
- Отвечай живой репликой, как реальный человек в переговорах — без списков и без мета-комментариев о том, что ты ИИ.
- Не завершай переговоры сам — решение о завершении принимает судья на основе оценки твоего ответа.
- Длина реплики — 2-4 предложения.`;
}

export function buildJudgePrompt(params: {
  scenario: Scenario;
  history: { role: "USER" | "OPPONENT"; text: string }[];
  lastUserMessage: string;
}): string {
  const { scenario, history, lastUserMessage } = params;

  const historyText = history
    .map((t) => `${t.role === "USER" ? "Игрок" : "Оппонент"}: ${t.text}`)
    .join("\n");

  return `Ты — судья тренажёра переговоров "Арена переговоров". Оцени последнюю реплику игрока и реши, как реагирует оппонент.

Контекст сценария: ${scenario.domain}.
Роль оппонента: ${scenario.opponentRole}, цели: ${scenario.opponentGoals}, тон: ${scenario.opponentTone}.
Критерий успеха для игрока: ${scenario.successCriteria}

История диалога:
${historyText}

Последняя реплика игрока: "${lastUserMessage}"

Оцени реплику игрока по критериям (0-100 каждый):
- argumentation — сила и обоснованность аргумента;
- interests — учёт интересов и целей оппонента, а не только своих;
- tone — уместность тона и переговорной техники.

Сгенерируй следующую реплику оппонента с учётом его роли, целей, тона и полученной оценки. Определи, завершились ли переговоры этим ходом (стороны пришли к однозначному финалу или зашли в тупик).

Ответь СТРОГО в формате JSON, без пояснений и без markdown-разметки:
{
  "score": number,
  "criteria": { "argumentation": number, "interests": number, "tone": number },
  "comment": string,
  "opponentReply": string,
  "isEnding": boolean,
  "endingOutcome": "deal" | "no_deal" | "partial" | null
}`;
}

export function buildFeedbackPrompt(params: {
  scenario: Scenario;
  history: { role: "USER" | "OPPONENT"; text: string; score?: number | null }[];
  outcome: "deal" | "no_deal" | "partial";
}): string {
  const { scenario, history, outcome } = params;

  const historyText = history
    .map(
      (t) =>
        `${t.role === "USER" ? "Игрок" : "Оппонент"}: ${t.text}${
          t.score != null ? ` (оценка реплики: ${t.score})` : ""
        }`
    )
    .join("\n");

  return `Ты — тренер по переговорам. Составь итоговый разбор сессии в тренажёре "Арена переговоров".

Контекст: ${scenario.domain}, роль оппонента: ${scenario.opponentRole}, цели: ${scenario.opponentGoals}.
Исход переговоров: ${outcome}.

Полная история диалога:
${historyText}

Составь разбор для игрока: что получилось хорошо, над чем стоит поработать, и общую оценку 0-100.
Пиши по-русски, конкретно и по делу, опираясь на реальные реплики игрока, а не общими фразами.

Ответь СТРОГО в формате JSON:
{
  "summary": string,
  "strengths": string,
  "improvements": string,
  "overallScore": number
}`;
}
