// lib/engine/feedbackFacts.ts
// Детерминированные "факты" для итогового Feedback, посчитанные из уже сохранённых Turn.
// Никакого обращения к БД/LLM — только агрегация данных, которые Engine уже сохранил
// (actionType/actionQuality на каждый Turn). LLM затем облекает эти факты в текст,
// но сами цифры/выбор реплики — не её работа.
import type { StageType } from "./types";

export const STAGE_TYPE_LABEL: Record<StageType, string> = {
  CONTACT: "Контакт",
  DISCOVERY: "Выявление потребности",
  PITCH: "Презентация решения",
  OBJECTION: "Работа с возражениями",
  CLOSING: "Закрытие",
};

const STAGE_TYPE_ORDER: StageType[] = ["CONTACT", "DISCOVERY", "PITCH", "OBJECTION", "CLOSING"];

export interface FeedbackTurnFact {
  role: "USER" | "OPPONENT";
  text: string;
  actionType: string | null;
  actionQuality: number | null;
  stageType: StageType | null;
}

export interface StageBreakdownFact {
  type: StageType;
  label: string;
  score: number; // среднее actionQuality по ходам игрока на этой стадии, 0-100
  turnCount: number;
}

/** Группирует ходы игрока по типу стадии и считает средний actionQuality — только по стадиям,
 * где игрок реально что-то говорил. GIBBERISH/OFF_TOPIC не участвуют — они не про "качество". */
export function buildStageBreakdown(turns: FeedbackTurnFact[]): StageBreakdownFact[] {
  const buckets = new Map<StageType, number[]>();

  for (const t of turns) {
    if (t.role !== "USER" || !t.stageType || t.actionQuality == null) continue;
    if (t.actionType === "GIBBERISH" || t.actionType === "OFF_TOPIC") continue;
    const arr = buckets.get(t.stageType) ?? [];
    arr.push(t.actionQuality);
    buckets.set(t.stageType, arr);
  }

  const result: StageBreakdownFact[] = [];
  for (const type of STAGE_TYPE_ORDER) {
    const values = buckets.get(type);
    if (!values || values.length === 0) continue;
    const score = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    result.push({ type, label: STAGE_TYPE_LABEL[type], score, turnCount: values.length });
  }
  return result;
}

export interface KeyMomentFact {
  quote: string;
  actionType: string | null;
  actionQuality: number | null;
  positive: boolean; // true = лучший ход (для успеха), false = худший/переломный (для провала)
}

/**
 * При успехе — реплика с максимальным actionQuality (что сработало лучше всего).
 * При провале — приоритет ABUSE-реплике (если была), иначе реплика с минимальным actionQuality.
 */
export function pickKeyMoment(
  turns: FeedbackTurnFact[],
  outcome: "deal" | "partial" | "failed"
): KeyMomentFact | null {
  const userTurns = turns.filter(
    (t) => t.role === "USER" && t.actionQuality != null && t.actionType !== "GIBBERISH" && t.actionType !== "OFF_TOPIC"
  );
  if (userTurns.length === 0) return null;

  const wantPositive = outcome !== "failed";
  let best = userTurns[0];

  for (const t of userTurns) {
    if (wantPositive) {
      if ((t.actionQuality ?? 0) > (best.actionQuality ?? 0)) best = t;
    } else {
      const bestIsAbuse = best.actionType === "ABUSE";
      const tIsAbuse = t.actionType === "ABUSE";
      if (tIsAbuse && !bestIsAbuse) best = t;
      else if (tIsAbuse === bestIsAbuse && (t.actionQuality ?? 100) < (best.actionQuality ?? 100)) best = t;
    }
  }

  return { quote: best.text, actionType: best.actionType, actionQuality: best.actionQuality, positive: wantPositive };
}
