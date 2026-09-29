// lib/engine/state.ts
import type { LevelWithStages, NegotiationState } from "./types";

export function createInitialState(firstLevel: LevelWithStages): NegotiationState {
  const firstStage = [...firstLevel.stages].sort((a, b) => a.order - b.order)[0];
  if (!firstStage) {
    throw new Error(`Level order=${firstLevel.order} has no stages`);
  }

  return {
    currentLevelOrder: firstLevel.order,
    currentStageOrder: firstStage.order,
    round: 0,
    maxRounds: firstLevel.maxRounds,
    player: { concessions: 0, arguments: 0, questions: 0, pressure: 0, rapport: 0 },
    opponent: { trust: 50, resistance: 50, interest: 50, pressure: 0, hiddenGoals: firstLevel.opponentGoals },
    stageProgress: { order: firstStage.order, type: firstStage.type, progress: 0, attempts: 0 },
    negotiation: { agreementProbability: 0, outcome: null },
    levelHistory: [],
  };
}
