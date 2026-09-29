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

export type StageConfig = Pick<Stage, "order" | "type" | "branchKey">;

export type LevelWithStages = LevelConfig & { stages: StageConfig[] };

// Ветвление сценария (см. комментарий над моделью Stage в prisma/schema.prisma). Несколько Stage
// могут делить один order внутри уровня — движок детерминированно выбирает вариант ("soft"/"hard")
// по накопленному за уровень соотношению мягких/жёстких действий игрока и фиксирует выбор в
// NegotiationState.branch на весь уровень.
export type BranchKey = "soft" | "hard";

export interface BranchSignal {
  soft: number; // RAPPORT + CONCESSION реплики с начала текущего уровня
  hard: number; // PRESSURE + ARGUMENT реплики с начала текущего уровня
}

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

  // Ветвление текущего уровня: branch — выбранный вариант (null, пока развилка не пройдена или
  // если в уровне развилок нет), branchSignal — счётчики с начала уровня, по которым движок решает,
  // в какую сторону пойти в момент развилки (lib/engine/transition.ts). Оба сбрасываются на новом
  // уровне. Опциональны в типе ради обратной совместимости с NegotiationState, сохранённым в БД до
  // появления ветвления — apply.ts/transition.ts трактуют отсутствие как {soft:0,hard:0}/null.
  branch?: BranchKey | null;
  branchSignal?: BranchSignal;

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
  branch?: BranchKey | null; // какой вариант развилки был выбран на этом уровне (если она была)
}
