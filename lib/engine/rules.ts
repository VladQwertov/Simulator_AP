// lib/engine/rules.ts
// Детерминированные правила: StageType x ActionType x quality -> state delta.
// Никакого универсального rule engine — просто две плоские таблицы + линейная формула,
// каждую ячейку можно прочитать и протестировать отдельно.
import type { ActionType, StageType } from "./types";

export interface ActionEffect {
  player: {
    concessions: number;
    arguments: number;
    questions: number;
    pressure: number;
    rapport: number;
  };
  opponent: {
    trust: number;
    resistance: number;
    interest: number;
    pressure: number;
  };
  agreementProbability: number;
}

const NO_PLAYER_DELTA = {
  concessions: 0,
  arguments: 0,
  questions: 0,
  pressure: 0,
  rapport: 0,
};

const NO_OPPONENT_DELTA = {
  trust: 0,
  resistance: 0,
  interest: 0,
  pressure: 0,
};

function round(n: number): number {
  return Math.round(n);
}

/**
 * Базовый эффект действия, не зависящий от текущей Stage.
 * delta = quality - 50, т.е. диапазон -50..+50 вокруг нейтрального качества.
 */
export function getBaseActionEffect(actionType: ActionType, quality: number): ActionEffect {
  const q = Math.min(100, Math.max(0, quality));
  const delta = q - 50;

  switch (actionType) {
    case "QUESTION":
      return {
        player: { ...NO_PLAYER_DELTA, questions: 1 },
        opponent: { ...NO_OPPONENT_DELTA, interest: round(delta * 0.4) },
        agreementProbability: 0,
      };

    case "ARGUMENT":
      return {
        player: { ...NO_PLAYER_DELTA, arguments: 1 },
        opponent: { ...NO_OPPONENT_DELTA, interest: round(delta * 0.2) },
        agreementProbability: round(delta * 0.3),
      };

    case "CONCESSION":
      // agreementProbability-множитель поднят с 0.25 до 0.35 (выше, чем у ARGUMENT: 0.3) — по итогам
      // живого прогона: живая уступка должна двигать согласие сильнее, чем просто аргумент/питч,
      // иначе даже уверенная серия уступок в CLOSING едва успевает добраться до advanceThreshold
      // за отведённые раунды (воспроизведено дважды: 25 и 28 из порога 30 при хорошей игре).
      return {
        player: { ...NO_PLAYER_DELTA, concessions: 1 },
        opponent: { ...NO_OPPONENT_DELTA, trust: round(delta * 0.3) },
        agreementProbability: round(delta * 0.35),
      };

    case "PRESSURE": {
      // Чем ниже качество давления (грубее, топорнее), тем сильнее откат.
      const poorness = 100 - q;
      return {
        player: { ...NO_PLAYER_DELTA, pressure: 1 },
        opponent: {
          ...NO_OPPONENT_DELTA,
          resistance: round(poorness * 0.3),
          trust: -round(poorness * 0.2),
          pressure: round(poorness * 0.15),
        },
        agreementProbability: 0,
      };
    }

    case "RAPPORT":
      return {
        player: { ...NO_PLAYER_DELTA, rapport: 1 },
        opponent: {
          ...NO_OPPONENT_DELTA,
          trust: round(delta * 0.4),
          pressure: -round(delta * 0.1),
        },
        agreementProbability: 0,
      };

    case "CLARIFICATION":
      return {
        player: { ...NO_PLAYER_DELTA, questions: 1 },
        opponent: { ...NO_OPPONENT_DELTA, interest: round(delta * 0.15) },
        agreementProbability: 0,
      };

    case "NEUTRAL":
      return {
        player: { ...NO_PLAYER_DELTA },
        opponent: { ...NO_OPPONENT_DELTA, interest: round(delta * 0.05) },
        agreementProbability: 0,
      };

    // Оскорбление — реальный удар по доверию. Фиксированный штраф, не зависящий от quality:
    // длинное оскорбление не "качественнее" короткого, поэтому шкала quality здесь не применяется.
    case "ABUSE":
      return {
        player: { ...NO_PLAYER_DELTA },
        opponent: { ...NO_OPPONENT_DELTA, trust: -15, resistance: 10 },
        agreementProbability: 0,
      };

    // Бессмысленный текст или уход от темы — переговоры топчутся на месте, раунд тратится впустую,
    // но напрямую состояние не портится (в отличие от ABUSE).
    case "GIBBERISH":
    case "OFF_TOPIC":
      return {
        player: { ...NO_PLAYER_DELTA },
        opponent: { ...NO_OPPONENT_DELTA },
        agreementProbability: 0,
      };
  }
}

/**
 * Насколько ActionType уместен на данном StageType:
 * 2 = ключевое действие стадии, 1 = уместно, 0 = нейтрально/не по теме,
 * -1/-2 = контрпродуктивно (уводит прогресс стадии назад, даже если само действие "качественное").
 */
// ABUSE/GIBBERISH/OFF_TOPIC не участвуют в этой формуле (см. getStageProgressDelta ниже) —
// значения здесь только для полноты типа Record<StageType, Record<ActionType, number>>.
const NO_RELEVANCE = { ABUSE: 0, GIBBERISH: 0, OFF_TOPIC: 0 };

export const STAGE_ACTION_RELEVANCE: Record<StageType, Record<ActionType, number>> = {
  CONTACT: {
    RAPPORT: 2,
    QUESTION: 1,
    CLARIFICATION: 1,
    NEUTRAL: 0,
    ARGUMENT: 0,
    CONCESSION: -1,
    PRESSURE: -1,
    ...NO_RELEVANCE,
  },
  DISCOVERY: {
    QUESTION: 2,
    CLARIFICATION: 1,
    RAPPORT: 1,
    NEUTRAL: 0,
    ARGUMENT: 0,
    CONCESSION: -1,
    PRESSURE: -1,
    ...NO_RELEVANCE,
  },
  PITCH: {
    ARGUMENT: 2,
    QUESTION: 1,
    CLARIFICATION: 1,
    RAPPORT: 0,
    NEUTRAL: 0,
    CONCESSION: 0,
    PRESSURE: -1,
    ...NO_RELEVANCE,
  },
  OBJECTION: {
    ARGUMENT: 2,
    CONCESSION: 2,
    CLARIFICATION: 1,
    QUESTION: 1,
    RAPPORT: 0,
    NEUTRAL: 0,
    PRESSURE: -1,
    ...NO_RELEVANCE,
  },
  CLOSING: {
    CONCESSION: 2,
    ARGUMENT: 1,
    QUESTION: 0,
    CLARIFICATION: 0,
    RAPPORT: 0,
    NEUTRAL: 0,
    PRESSURE: -2,
    ...NO_RELEVANCE,
  },
};

// Фиксированный штраф прогресса стадии за оскорбление — не зависит от quality (см. комментарий
// у getBaseActionEffect/ABUSE выше: "качественного оскорбления" не бывает).
const ABUSE_PROGRESS_PENALTY = -15;

export function getStageProgressDelta(
  stageType: StageType,
  actionType: ActionType,
  quality: number
): number {
  // Специальный случай: для мусорных категорий формула quality*relevance не применяется —
  // relevance=-1 при quality<50 дал бы ПОЛОЖИТЕЛЬНЫЙ прогресс (минус на минус), что неверно.
  if (actionType === "GIBBERISH" || actionType === "OFF_TOPIC") return 0;
  if (actionType === "ABUSE") return ABUSE_PROGRESS_PENALTY;

  const q = Math.min(100, Math.max(0, quality));
  const delta = q - 50;
  const relevance = STAGE_ACTION_RELEVANCE[stageType][actionType];
  return round(delta * relevance * 0.5);
}
