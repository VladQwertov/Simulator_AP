// app/api/scenarios/[id]/levels/[levelId]/route.ts
// Admin API: редактирование/удаление одного Level. Reorder — в соседнем route.ts (reorder/).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateLevelInput } from "@/lib/validation";
import { renumberLevels } from "@/lib/admin/ordering";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; levelId: string }> }
) {
  const { id: scenarioId, levelId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const existing = await prisma.level.findFirst({ where: { id: levelId, scenarioId } });
  if (!existing) {
    return NextResponse.json({ error: "Уровень не найден" }, { status: 404 });
  }

  const input = {
    title: typeof body.title === "string" ? body.title : existing.title,
    opponentRole: typeof body.opponentRole === "string" ? body.opponentRole : existing.opponentRole,
    opponentTone: typeof body.opponentTone === "string" ? body.opponentTone : existing.opponentTone,
    opponentGoals: typeof body.opponentGoals === "string" ? body.opponentGoals : existing.opponentGoals,
    objective: typeof body.objective === "string" ? body.objective : existing.objective,
    openingLine: typeof body.openingLine === "string" ? body.openingLine : existing.openingLine,
    maxRounds: Number.isFinite(body.maxRounds) ? Number(body.maxRounds) : existing.maxRounds,
    advanceThreshold: Number.isFinite(body.advanceThreshold) ? Number(body.advanceThreshold) : existing.advanceThreshold,
    failThreshold: Number.isFinite(body.failThreshold) ? Number(body.failThreshold) : existing.failThreshold,
  };

  const errors = validateLevelInput(input);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  const level = await prisma.level.update({
    where: { id: levelId },
    data: input,
    include: { stages: { orderBy: { order: "asc" } } },
  });

  return NextResponse.json(level);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; levelId: string }> }
) {
  const { id: scenarioId, levelId } = await params;

  const existing = await prisma.level.findFirst({ where: { id: levelId, scenarioId } });
  if (!existing) {
    return NextResponse.json({ error: "Уровень не найден" }, { status: 404 });
  }

  // Сценарий с 0 уровней не запускается (createSession уже проверяет это), но лучше не
  // допускать такое состояние вообще — тот же класс проблем, что и с последней Stage.
  const levelCount = await prisma.level.count({ where: { scenarioId } });
  if (levelCount <= 1) {
    return NextResponse.json(
      { error: "Нельзя удалить последний уровень сценария — у сценария должен остаться хотя бы один уровень" },
      { status: 409 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.stage.deleteMany({ where: { levelId } });
    await tx.level.delete({ where: { id: levelId } });
    await renumberLevels(tx, scenarioId);
  });

  return NextResponse.json({ ok: true });
}
