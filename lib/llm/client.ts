// lib/llm/client.ts
// Обёртка над prompts.ts: реально отправляет запросы в LLM API,
// парсит JSON-ответ и предоставляет мок-режим на случай сбоя/отсутствия ключа.

import type { Scenario } from "@prisma/client";
import {
  buildJudgePrompt,
  buildFeedbackPrompt,
  type JudgeResult,
  type FeedbackResult,
} from "./prompts";

const MOCK = process.env.MOCK_LLM === "true";
const MODEL = process.env.LLM_MODEL ?? "llama-3.3-70b-versatile";

type HistoryTurn = {
  role: "USER" | "OPPONENT";
  text: string;
  score?: number | null;
};

// Заглушки для мок-режима — используются, если MOCK_LLM=true,
// либо если реальный вызов к API упал с ошибкой (сеть, ключ, лимиты).
const MOCK_JUDGE_RESULT: JudgeResult = {
  score: 65,
  criteria: { argumentation: 60, interests: 65, tone: 70 },
  comment: "Аргумент неплохой, но не хватает учёта интересов оппонента.",
  opponentReply: "Понимаю вашу позицию, но мне нужны более веские гарантии.",
  isEnding: false,
  endingOutcome: null,
};

const MOCK_FEEDBACK_RESULT: FeedbackResult = {
  summary: "Переговоры прошли ровно, стороны нашли компромисс по ключевым пунктам.",
  strengths: "Хорошая аргументация в начале диалога, уверенный тон.",
  improvements: "Стоит больше внимания уделять интересам оппонента, а не только своим целям.",
  overallScore: 68,
};

async function callLLM(prompt: string): Promise<string> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.error("Не удалось распарсить ответ LLM, использую fallback:", err, raw);
    return fallback;
  }
}

/**
 * Оценивает последнюю реплику игрока и возвращает ответ оппонента.
 * Используется юзер-флоу в /api/sessions/:id/turn.
 */
export async function judgeTurn(params: {
  scenario: Scenario;
  history: HistoryTurn[];
  lastUserMessage: string;
}): Promise<JudgeResult> {
  if (MOCK) return MOCK_JUDGE_RESULT;

  try {
    const prompt = buildJudgePrompt(params);
    const raw = await callLLM(prompt);
    return parseJSON<JudgeResult>(raw, MOCK_JUDGE_RESULT);
  } catch (err) {
    console.error("judgeTurn упал, отдаю fallback:", err);
    return MOCK_JUDGE_RESULT;
  }
}

/**
 * Генерирует итоговый разбор завершённой сессии.
 * Используется юзер-флоу в /api/sessions/:id/feedback.
 */
export async function generateFeedback(params: {
  scenario: Scenario;
  history: HistoryTurn[];
  outcome: "deal" | "no_deal" | "partial";
}): Promise<FeedbackResult> {
  if (MOCK) return MOCK_FEEDBACK_RESULT;

  try {
    const prompt = buildFeedbackPrompt(params);
    const raw = await callLLM(prompt);
    return parseJSON<FeedbackResult>(raw, MOCK_FEEDBACK_RESULT);
  } catch (err) {
    console.error("generateFeedback упал, отдаю fallback:", err);
    return MOCK_FEEDBACK_RESULT;
  }
}
