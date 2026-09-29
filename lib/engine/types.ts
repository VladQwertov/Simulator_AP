// lib/engine/types.ts
// Типы детерминированного Negotiation Engine.
// LevelConfig/StageConfig — проекции полей Prisma-моделей Level/Stage (через Pick),
// а не полные строки БД: движку не нужны id/scenarioId/createdAt и т.п.
import type { Level, Stage, StageType } from "@prisma/client";

export type { StageType };

export type ActionType =
  | "QUESTION"
  | "ARGUMENT"
  | "CONCESSION"
  | "PRESSURE"
  | "RAPPORT"
  | "CLARIFICATION"
  | "NEUTRAL"
  | "ABUSE" // оскорбления/токсичность — реальный негативный эффект, не просто "0 прогресса"
  | "GIBBERISH" // бессмысленный/слишком короткий текст без содержания
  | "OFF_TOPIC"; // не по теме переговоров

export const ACTION_TYPES: readonly ActionType[] = [
  "QUESTION",
  "ARGUMENT",
  "CONCESSION",
  "PRESSURE",
  "RAPPORT",
  "CLARIFICATION",
  "NEUTRAL",
  "ABUSE",
  "GIBBERISH",
  "OFF_TOPIC",
];

export type LevelConfig = Pick<
  Level,
  | "order"
  | "title"
  | "opponentGoals"
  | "maxRounds"
  | "advanceThreshold"
  | "failThreshold"
>;

export type StageConfig = Pick<Stage, "order" | "type">;

export type LevelWithStages = LevelConfig & { stages: StageConfig[] };

export interface PlayerState {
  concessions: number;
  arguments: number;
  questions: number;
  pressure: number;
  rapport: number;
}

export interface OpponentState {
  trust: number;
  resistance: number;
  interest: number;
  pressure: number;
  hiddenGoals: string;
}

export interface StageProgressState {
  order: number;
  type: StageType;
  progress: number; // 0-100, обнуляется при переходе на следующую Stage
  attempts: number; // сколько ходов потрачено на текущую Stage
}

export type NegotiationOutcome = "deal" | "partial" | "failed";

export interface NegotiationState {
  currentLevelOrder: number;
  currentStageOrder: number;
  round: number; // раунд внутри текущего Level, сбрасывается при переходе на новый Level
  maxRounds: number; // скопировано из текущего Level на момент входа в него

  player: PlayerState;
  opponent: OpponentState;
  stageProgress: StageProgressState;

  negotiation: {
    agreementProbability: number;
    outcome: NegotiationOutcome | null; // null, пока сценарий не завершён
  };

  levelHistory: LevelHistoryEntry[];
}

export type LevelHistoryResult = "advanced" | "failed";

export interface LevelHistoryEntry {
  levelOrder: number;
  title: string;
  result: LevelHistoryResult;
  roundsUsed: number;
  finalScore: number; // agreementProbability на момент завершения уровня
}
