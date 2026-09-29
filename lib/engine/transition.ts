// lib/engine/transition.ts
// Детерминированное решение о том, что происходит после applyAction:
// continue | advance-stage | advance-level | fail-level | finish.
import type { LevelWithStages, NegotiationState, OpponentState, StageProgressState } from "./types";
import { clamp } from "./util";

export type TransitionKind = "continue" | "advance-stage" | "advance-level" | "fail-level" | "finish";

export interface TransitionResult {
  state: NegotiationState;
  transition: TransitionKind;
}

export const STAGE_COMPLETE_THRESHOLD = 100;
export const DEAL_TIER_THRESHOLD = 85;

function sortedStagesOf(level: LevelWithStages) {
  return [...level.stages].sort((a, b) => a.order - b.order);
}

function freshOpponentState(hiddenGoals: string): OpponentState {
  return { trust: 50, resistance: 50, interest: 50, pressure: 0, hiddenGoals };
}

function freshStageProgress(order: number, type: StageProgressState["type"]): StageProgressState {
  return { order, type, progress: 0, attempts: 0 };
}

function withFailure(state: NegotiationState, level: LevelWithStages): NegotiationState {
  return {
    ...state,
    negotiation: { ...state.negotiation, outcome: "failed" },
    levelHistory: [
      ...state.levelHistory,
      {
        levelOrder: level.order,
        title: level.title,
        result: "failed",
        roundsUsed: state.round,
        finalScore: state.negotiation.agreementProbability,
      },
    ],
  };
}

function withFinish(state: NegotiationState, level: LevelWithStages): NegotiationState {
  const tier = state.negotiation.agreementProbability >= DEAL_TIER_THRESHOLD ? "deal" : "partial";
  return {
    ...state,
    negotiation: { ...state.negotiation, outcome: tier },
    levelHistory: [
      ...state.levelHistory,
      {
        levelOrder: level.order,
        title: level.title,
        result: "advanced",
        roundsUsed: state.round,
        finalScore: state.negotiation.agreementProbability,
      },
    ],
  };
}

function withAdvanceStage(state: NegotiationState, nextStage: { order: number; type: StageProgressState["type"] }): NegotiationState {
  return {
    ...state,
    currentStageOrder: nextStage.order,
    stageProgress: freshStageProgress(nextStage.order, nextStage.type),
  };
}

function withAdvanceLevel(
  state: NegotiationState,
  level: LevelWithStages,
  nextLevel: LevelWithStages
): NegotiationState {
  const nextFirstStage = sortedStagesOf(nextLevel)[0];
  if (!nextFirstStage) {
    throw new Error(`Level order=${nextLevel.order} has no stages`);
  }

  return {
    ...state,
    currentLevelOrder: nextLevel.order,
    currentStageOrder: nextFirstStage.order,
    round: 0,
    maxRounds: nextLevel.maxRounds,
    // player сохраняется как есть (накопительный прогресс игрока через уровни).
    opponent: freshOpponentState(nextLevel.opponentGoals),
    stageProgress: freshStageProgress(nextFirstStage.order, nextFirstStage.type),
    negotiation: { agreementProbability: 0, outcome: null },
    levelHistory: [
      ...state.levelHistory,
      {
        levelOrder: level.order,
        title: level.title,
        result: "advanced",
        roundsUsed: state.round,
        finalScore: state.negotiation.agreementProbability,
      },
    ],
  };
}

export function evaluateTransition(
  state: NegotiationState,
  level: LevelWithStages,
  nextLevel: LevelWithStages | null
): TransitionResult {
  const stages = sortedStagesOf(level);
  const currentStage = stages.find((s) => s.order === state.currentStageOrder);
  if (!currentStage) {
    throw new Error(`Stage order=${state.currentStageOrder} not found in level order=${level.order}`);
  }
  const isLastStage = currentStage.order === stages[stages.length - 1].order;

  // 1. Критический провал отношений — перекрывает всё остальное.
  const trust = clamp(state.opponent.trust, 0, 100);
  const interest = clamp(state.opponent.interest, 0, 100);
  if (trust <= level.failThreshold || interest <= level.failThreshold) {
    return { state: withFailure(state, level), transition: "fail-level" };
  }

  // 2. Текущая Stage завершена (прогресс дошёл до порога)?
  if (state.stageProgress.progress >= STAGE_COMPLETE_THRESHOLD) {
    if (!isLastStage) {
      const nextStage = stages[stages.findIndex((s) => s.order === currentStage.order) + 1];
      return { state: withAdvanceStage(state, nextStage), transition: "advance-stage" };
    }

    // Последняя Stage уровня: контент отработан, но нужен ещё достаточный agreementProbability.
    if (state.negotiation.agreementProbability >= level.advanceThreshold) {
      if (!nextLevel) {
        return { state: withFinish(state, level), transition: "finish" };
      }
      return { state: withAdvanceLevel(state, level, nextLevel), transition: "advance-level" };
    }
    // Иначе — стадия формально пройдена, но сделка ещё не дозрела: даём шанс дожать,
    // пока не кончатся раунды (проверка ниже).
  }

  // 3. Лимит раундов исчерпан без успешного перехода.
  if (state.round >= state.maxRounds) {
    return { state: withFailure(state, level), transition: "fail-level" };
  }

  // 4. Попытка ещё допустима.
  return { state, transition: "continue" };
}
