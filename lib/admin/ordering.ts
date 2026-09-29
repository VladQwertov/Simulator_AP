// lib/admin/ordering.ts
// Вспомогательная логика для Admin API: перестановка соседей (reorder) и пересчёт
// order по возрастанию без пропусков после удаления (Engine ищет следующий Level/Stage
// по order+1, поэтому порядок обязан оставаться непрерывным 1..N).
import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

// Временное значение заведомо больше любого реального order — исключает конфликт
// с @@unique([scenarioId, order]) / @@unique([levelId, order]) на промежуточном шаге.
const TEMP_ORDER_OFFSET = 1_000_000;

export async function swapLevelOrder(tx: Tx, levelId: string, neighborId: string) {
  const [level, neighbor] = await Promise.all([
    tx.level.findUniqueOrThrow({ where: { id: levelId } }),
    tx.level.findUniqueOrThrow({ where: { id: neighborId } }),
  ]);

  await tx.level.update({ where: { id: level.id }, data: { order: TEMP_ORDER_OFFSET } });
  await tx.level.update({ where: { id: neighbor.id }, data: { order: level.order } });
  await tx.level.update({ where: { id: level.id }, data: { order: neighbor.order } });
}

export async function swapStageOrder(tx: Tx, stageId: string, neighborId: string) {
  const [stage, neighbor] = await Promise.all([
    tx.stage.findUniqueOrThrow({ where: { id: stageId } }),
    tx.stage.findUniqueOrThrow({ where: { id: neighborId } }),
  ]);

  await tx.stage.update({ where: { id: stage.id }, data: { order: TEMP_ORDER_OFFSET } });
  await tx.stage.update({ where: { id: neighbor.id }, data: { order: stage.order } });
  await tx.stage.update({ where: { id: stage.id }, data: { order: neighbor.order } });
}

export async function renumberLevels(tx: Tx, scenarioId: string) {
  const levels = await tx.level.findMany({ where: { scenarioId }, orderBy: { order: "asc" } });
  await Promise.all(levels.map((l, i) => tx.level.update({ where: { id: l.id }, data: { order: TEMP_ORDER_OFFSET + i } })));
  await Promise.all(levels.map((l, i) => tx.level.update({ where: { id: l.id }, data: { order: i + 1 } })));
}

export async function renumberStages(tx: Tx, levelId: string) {
  const stages = await tx.stage.findMany({ where: { levelId }, orderBy: { order: "asc" } });
  await Promise.all(stages.map((s, i) => tx.stage.update({ where: { id: s.id }, data: { order: TEMP_ORDER_OFFSET + i } })));
  await Promise.all(stages.map((s, i) => tx.stage.update({ where: { id: s.id }, data: { order: i + 1 } })));
}
