// lib/engine/transition.ts
// Детерминированное решение о том, что происходит после applyAction:
// continue | advance-stage | advance-level | fail-level | finish.
import type { BranchKey, LevelWithStages, NegotiationState, OpponentState, StageProgressState } from "./types";
import { clamp, findStageByOrder } from "./util";

export type TransitionKind = "continue" | "advance-stage" | "advance-level" | "fail-level" | "finish";

export interface TransitionResult {
  state: NegotiationState;
  transition: TransitionKind;
}

export const STAGE_COMPLETE_THRESHOLD = 100;
export const DEAL_TIER_THRESHOLD = 85;

function freshOpponentState(hiddenGoals: string): OpponentState {
  return { trust: 50, resistance: 50, interest: 50, pressure: 0, hiddenGoals };
}

function freshStageProgress(order: number, type: StageProgressState["type"]): StageProgressState {
  return { order, type, progress: 0, attempts: 0 };
}

/**
 * Все Stage уровня, ОТСОРТИРОВАННЫЕ по order, БЕЗ фильтрации по ветке — на одном order может
 * лежать несколько Stage (развилка), это разрешено умышленно. Использовать только для поиска
 * кандидатов на конкретный order (см. candidatesAtOrder/maxOrderOf), не для построения "текущего
 * пути" целиком.
 */
function allStagesRaw(level: LevelWithStages) {
  return [...level.stages].sort((a, b) => a.order - b.order);
}

function candidatesAtOrder(level: LevelWithStages, order: number) {
  return level.stages.filter((s) => s.order === order);
}

function maxOrderOf(level: LevelWithStages): number {
  return allStagesRaw(level).reduce((max, s) => Math.max(max, s.order), 0);
}

/**
 * Решение о том, в какую сторону идёт развилка — детерминированно, по накопленному за уровень
 * соотношению мягких (RAPPORT/CONCESSION) и жёстких (PRESSURE/ARGUMENT) действий игрока
 * (см. apply.ts). Ничья и отсутствие сигнала (в начале уровня) трактуются в пользу "soft" —
 * нейтральный/дефолтный вариант, не наказывающий игрока за малое число ходов до развилки.
 */
function decideBranch(state: NegotiationState): BranchKey {
  const signal = state.branchSignal ?? { soft: 0, hard: 0 };
  return signal.hard > signal.soft ? "hard" : "soft";
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
        branch: state.branch ?? null,
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
        branch: state.branch ?? null,
      },
    ],
  };
}

function withAdvanceStage(
  state: NegotiationState,
  nextStage: { order: number; type: StageProgressState["type"] },
  branch: BranchKey | null
): NegotiationState {
  return {
    ...state,
    branch,
    currentStageOrder: nextStage.order,
    stageProgress: freshStageProgress(nextStage.order, nextStage.type),
  };
}

function withAdvanceLevel(
  state: NegotiationState,
  level: LevelWithStages,
  nextLevel: LevelWithStages
): NegotiationState {
  // Первый Stage следующего уровня не должен сам быть развилкой (см. комментарий у модели Stage
  // в prisma/schema.prisma) — берём единственный Stage с минимальным order и branchKey=null.
  // == null (не ===) — см. комментарий у findStageByOrder в util.ts: объекты без явного branchKey
  // (тесты, частичные выборки) трактуются так же, как явный null.
  const nextFirstStage = allStagesRaw(nextLevel).find((s) => s.branchKey == null);
  if (!nextFirstStage) {
    throw new Error(`Level order=${nextLevel.order} has no non-branching first stage`);
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
    branch: null,
    branchSignal: { soft: 0, hard: 0 },
    negotiation: { agreementProbability: 0, outcome: null },
    levelHistory: [
      ...state.levelHistory,
      {
        levelOrder: level.order,
        title: level.title,
        result: "advanced",
        roundsUsed: state.round,
        finalScore: state.negotiation.agreementProbability,
        branch: state.branch ?? null,
      },
    ],
  };
}

export function evaluateTransition(
  state: NegotiationState,
  level: LevelWithStages,
  nextLevel: LevelWithStages | null
): TransitionResult {
  const branch = state.branch ?? null;
  const currentStage = findStageByOrder(level.stages, state.currentStageOrder, branch);
  if (!currentStage) {
    throw new Error(`Stage order=${state.currentStageOrder} not found in level order=${level.order}`);
  }
  const maxOrder = maxOrderOf(level);
  const isLastStage = currentStage.order === maxOrder;

  // 1. Критический провал отношений — перекрывает всё остальное.
  const trust = clamp(state.opponent.trust, 0, 100);
  const interest = clamp(state.opponent.interest, 0, 100);
  if (trust <= level.failThreshold || interest <= level.failThreshold) {
    return { state: withFailure(state, level), transition: "fail-level" };
  }

  // 2. Текущая Stage завершена (прогресс дошёл до порога)?
  if (state.stageProgress.progress >= STAGE_COMPLETE_THRESHOLD) {
    if (!isLastStage) {
      const candidates = candidatesAtOrder(level, currentStage.order + 1);
      if (candidates.length === 0) {
        throw new Error(`Level order=${level.order} has a gap after order=${currentStage.order}`);
      }
      // Развилка: на следующем order лежит больше одного варианта Stage — решаем один раз
      // по накопленному branchSignal и фиксируем выбор на весь уровень (withAdvanceStage).
      const resolvedBranch = candidates.length > 1 ? decideBranch(state) : branch;
      const nextStage = candidates.find((c) => c.branchKey === resolvedBranch) ?? candidates[0];
      return { state: withAdvanceStage(state, nextStage, resolvedBranch), transition: "advance-stage" };
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
