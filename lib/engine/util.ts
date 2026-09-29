// lib/engine/util.ts
import type { BranchKey, StageConfig } from "./types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Находит Stage по order с учётом ветвления: если на этом order несколько Stage
 * (развилка — см. модель Stage в prisma/schema.prisma), берёт ту, чей branchKey совпадает
 * с уже выбранной веткой уровня; вне развилки branchKey всегда null и просто совпадает.
 */
export function findStageByOrder<T extends Pick<StageConfig, "order" | "branchKey">>(
  stages: readonly T[],
  order: number,
  branch: BranchKey | null | undefined
): T | undefined {
  // == null (не ===) — трактует и null, и undefined как "основной путь": Prisma всегда отдаёт
  // явный null для NOT SET, но объекты, собранные вручную (тесты, старые частичные выборки),
  // могут просто не иметь этого поля.
  return stages.find((s) => s.order === order && (s.branchKey == null || s.branchKey === (branch ?? null)));
}
