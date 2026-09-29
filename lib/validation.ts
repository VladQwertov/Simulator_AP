// lib/validation.ts
// Базовая серверная валидация для Admin API. Никакой библиотеки — просто функции,
// возвращающие список ошибок (пустой массив = валидно).
import type { StageType } from "@prisma/client";

const STAGE_TYPES: readonly StageType[] = ["CONTACT", "DISCOVERY", "PITCH", "OBJECTION", "CLOSING"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface ScenarioInput {
  title: string;
  domain?: string;
  successCriteria?: string;
  playerRole?: string;
  situation?: string;
}

// playerRole/situation не обязательны при создании (как и domain/successCriteria) — черновик
// можно создать с одним title и дозаполнить остальное в редакторе. Но публиковать сценарий без
// них не стоит: экран контекста перед стартом останется пустым для игрока — см. validatePublishReady.
export function validateScenarioInput(input: ScenarioInput): string[] {
  const errors: string[] = [];
  if (!isNonEmptyString(input.title)) errors.push("title не может быть пустым");
  return errors;
}

/** Дополнительная проверка перед публикацией — контекст-экран не должен быть пустым для игрока. */
export function validatePublishReady(input: Omit<ScenarioInput, "title">): string[] {
  const errors: string[] = [];
  if (!isNonEmptyString(input.playerRole)) errors.push("нельзя опубликовать сценарий без playerRole");
  if (!isNonEmptyString(input.situation)) errors.push("нельзя опубликовать сценарий без situation");
  if (!isNonEmptyString(input.successCriteria)) errors.push("нельзя опубликовать сценарий без successCriteria");
  return errors;
}

export interface LevelInput {
  title: string;
  objective: string;
  openingLine: string;
  maxRounds: number;
  advanceThreshold: number;
  failThreshold: number;
}

export function validateLevelInput(input: LevelInput): string[] {
  const errors: string[] = [];
  if (!isNonEmptyString(input.title)) errors.push("title не может быть пустым");
  if (!isNonEmptyString(input.objective)) errors.push("objective не может быть пустым");
  if (!isNonEmptyString(input.openingLine)) errors.push("openingLine не может быть пустым");
  if (!Number.isInteger(input.maxRounds) || input.maxRounds <= 0) errors.push("maxRounds должен быть целым числом больше 0");
  if (!Number.isInteger(input.advanceThreshold) || input.advanceThreshold < 0 || input.advanceThreshold > 100) {
    errors.push("advanceThreshold должен быть целым числом в диапазоне 0..100");
  }
  if (!Number.isInteger(input.failThreshold) || input.failThreshold < 0 || input.failThreshold > 100) {
    errors.push("failThreshold должен быть целым числом в диапазоне 0..100");
  }
  if (
    Number.isFinite(input.failThreshold) &&
    Number.isFinite(input.advanceThreshold) &&
    input.failThreshold >= input.advanceThreshold
  ) {
    errors.push("failThreshold должен быть меньше advanceThreshold");
  }
  return errors;
}

export interface StageInput {
  type: string;
}

export function validateStageInput(input: StageInput): string[] {
  const errors: string[] = [];
  if (!isNonEmptyString(input.type) || !STAGE_TYPES.includes(input.type as StageType)) {
    errors.push(`type должен быть одним из: ${STAGE_TYPES.join(", ")}`);
  }
  return errors;
}
