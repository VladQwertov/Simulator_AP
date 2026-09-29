// lib/engine/apply.ts
// Чистая функция применения одного хода игрока к состоянию.
// Не обращается к БД, не вызывает LLM, не генерирует текст — только считает новый state.
import type { ActionType, LevelConfig, NegotiationState, StageConfig } from "./types";
import { getBaseActionEffect, getStageProgressDelta } from "./rules";
import { clamp } from "./util";

export function applyAction(
  state: NegotiationState,
  level: LevelConfig,
  stage: StageConfig,
  actionType: ActionType,
  quality: number
): NegotiationState {
  const effect = getBaseActionEffect(actionType, quality);
  const stageProgressDelta = getStageProgressDelta(stage.type, actionType, quality);

  const player = {
    concessions: state.player.concessions + effect.player.concessions,
    arguments: state.player.arguments + effect.player.arguments,
    questions: state.player.questions + effect.player.questions,
    pressure: state.player.pressure + effect.player.pressure,
    rapport: state.player.rapport + effect.player.rapport,
  };

  const opponent = {
    trust: clamp(state.opponent.trust + effect.opponent.trust, 0, 100),
    resistance: clamp(state.opponent.resistance + effect.opponent.resistance, 0, 100),
    interest: clamp(state.opponent.interest + effect.opponent.interest, 0, 100),
    pressure: clamp(state.opponent.pressure + effect.opponent.pressure, 0, 100),
    hiddenGoals: state.opponent.hiddenGoals,
  };

  // Сигнал для развилки (lib/engine/transition.ts): копится с начала текущего уровня, сбрасывается
  // withAdvanceLevel. ?? {soft:0,hard:0} — на случай NegotiationState, сохранённого до появления
  // ветвления (см. комментарий у поля branchSignal в types.ts).
  const prevSignal = state.branchSignal ?? { soft: 0, hard: 0 };
  const branchSignal = {
    soft: prevSignal.soft + (actionType === "RAPPORT" || actionType === "CONCESSION" ? 1 : 0),
    hard: prevSignal.hard + (actionType === "PRESSURE" || actionType === "ARGUMENT" ? 1 : 0),
  };

  return {
    ...state,
    round: state.round + 1,
    player,
    opponent,
    branchSignal,
    stageProgress: {
      ...state.stageProgress,
      progress: clamp(state.stageProgress.progress + stageProgressDelta, 0, 100),
      attempts: state.stageProgress.attempts + 1,
    },
    negotiation: {
      ...state.negotiation,
      agreementProbability: clamp(
        state.negotiation.agreementProbability + effect.agreementProbability,
        0,
        100
      ),
    },
  };
}
