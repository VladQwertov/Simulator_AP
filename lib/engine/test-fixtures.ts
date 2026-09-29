// lib/engine/test-fixtures.ts
// Общие фикстуры для юнит-тестов движка. Не тестовый файл сам по себе (нет .test. в имени).
import type { LevelWithStages, NegotiationState, StageConfig } from "./types";

export function makeStage(overrides: Partial<StageConfig> = {}): StageConfig {
  return { order: 1, type: "CONTACT", ...overrides };
}

export function makeLevel(
  overrides: Partial<Omit<LevelWithStages, "stages">> & { stages?: StageConfig[] } = {}
): LevelWithStages {
  const { stages, ...rest } = overrides;
  return {
    order: 1,
    title: "Level 1",
    opponentGoals: "Test opponent goals",
    maxRounds: 6,
    advanceThreshold: 70,
    failThreshold: 20,
    stages: stages ?? [makeStage({ order: 1, type: "CONTACT" }), makeStage({ order: 2, type: "DISCOVERY" })],
    ...rest,
  };
}

export function makeState(overrides: Partial<NegotiationState> = {}): NegotiationState {
  return {
    currentLevelOrder: 1,
    currentStageOrder: 1,
    round: 0,
    maxRounds: 6,
    player: { concessions: 0, arguments: 0, questions: 0, pressure: 0, rapport: 0 },
    opponent: { trust: 50, resistance: 50, interest: 50, pressure: 0, hiddenGoals: "Test opponent goals" },
    stageProgress: { order: 1, type: "CONTACT", progress: 0, attempts: 0 },
    negotiation: { agreementProbability: 0, outcome: null },
    levelHistory: [],
    ...overrides,
  };
}
