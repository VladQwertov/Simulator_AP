// lib/engine/score.ts
// Детерминированный итоговый score сессии. Никакого обращения к БД/LLM —
// только levelHistory, уже посчитанная движком (lib/engine/transition.ts).
import type { LevelHistoryEntry } from "./types";
import { clamp } from "./util";

/**
 * Среднее finalScore (agreementProbability на момент завершения уровня) по всем
 * уровням в истории. Провал уровня сам по себе не даёт отдельного штрафа —
 * он и так обычно означает низкий finalScore, потому что fail-level срабатывает
 * либо при критическом провале доверия/интереса, либо когда agreementProbability
 * не дотянул до advanceThreshold к моменту исчерпания раундов.
 */
export function calculateOverallScore(levelHistory: LevelHistoryEntry[]): number {
  if (levelHistory.length === 0) return 0;

  const sum = levelHistory.reduce((acc, entry) => acc + entry.finalScore, 0);
  const average = sum / levelHistory.length;

  return Math.round(clamp(average, 0, 100));
}
