// lib/engine/index.ts
// Единая точка входа для API-слоя: применить действие игрока и получить новый state + transition.
// Внутри — только apply.ts/transition.ts. Никакого обращения к БД и никакого LLM.
import { applyAction } from "./apply";
import { evaluateTransition, type TransitionKind } from "./transition";
import type { ActionType, LevelWithStages, NegotiationState } from "./types";

export interface ProcessTurnInput {
  state: NegotiationState;
  level: LevelWithStages; // уровень, соответствующий state.currentLevelOrder
  nextLevel: LevelWithStages | null; // следующий уровень сценария, если есть
  actionType: ActionType;
  quality: number;
}

export interface ProcessTurnResult {
  state: NegotiationState;
  transition: TransitionKind;
  isEnding: boolean;
}

export function processTurn(input: ProcessTurnInput): ProcessTurnResult {
  const { state, level, nextLevel, actionType, quality } = input;

  const currentStage = level.stages.find((s) => s.order === state.currentStageOrder);
  if (!currentStage) {
    throw new Error(`Stage order=${state.currentStageOrder} not found in level order=${level.order}`);
  }

  const stateAfterAction = applyAction(state, level, currentStage, actionType, quality);
  const { state: finalState, transition } = evaluateTransition(stateAfterAction, level, nextLevel);

  return {
    state: finalState,
    transition,
    isEnding: transition === "finish" || transition === "fail-level",
  };
}

export { applyAction } from "./apply";
export { createInitialState } from "./state";
export { calculateOverallScore } from "./score";
export { evaluateTransition, STAGE_COMPLETE_THRESHOLD, DEAL_TIER_THRESHOLD } from "./transition";
export type { TransitionKind } from "./transition";
export { STAGE_TYPE_LABEL, buildStageBreakdown, pickKeyMoment } from "./feedbackFacts";
export type { FeedbackTurnFact, StageBreakdownFact, KeyMomentFact } from "./feedbackFacts";
export { deriveOpponentMood } from "./mood";
export type { OpponentMood } from "./mood";
export * from "./types";
