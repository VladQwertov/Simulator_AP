import { describe, expect, it } from "vitest";
import { calculateOverallScore } from "./score";
import type { LevelHistoryEntry } from "./types";

function entry(overrides: Partial<LevelHistoryEntry> = {}): LevelHistoryEntry {
  return { levelOrder: 1, title: "Level", result: "advanced", roundsUsed: 3, finalScore: 0, ...overrides };
}

describe("calculateOverallScore", () => {
  it("пустая levelHistory даёт 0, а не NaN", () => {
    expect(calculateOverallScore([])).toBe(0);
  });

  it("один уровень -> score равен его finalScore", () => {
    expect(calculateOverallScore([entry({ finalScore: 82 })])).toBe(82);
  });

  it("несколько уровней -> округлённое среднее finalScore", () => {
    const history = [entry({ finalScore: 80 }), entry({ finalScore: 75 }), entry({ finalScore: 90 })];
    expect(calculateOverallScore(history)).toBe(82); // (80+75+90)/3 = 81.66 -> 82
  });

  it("провал уровня в истории тянет средний score вниз пропорционально его finalScore", () => {
    const history = [entry({ finalScore: 75, result: "advanced" }), entry({ finalScore: 15, result: "failed" })];
    expect(calculateOverallScore(history)).toBe(45);
  });

  it("результат всегда в диапазоне 0..100 независимо от входных данных", () => {
    const score = calculateOverallScore([entry({ finalScore: 100 }), entry({ finalScore: 0 })]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
