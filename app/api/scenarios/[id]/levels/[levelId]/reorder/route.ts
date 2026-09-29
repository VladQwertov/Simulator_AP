// app/api/scenarios/[id]/levels/[levelId]/reorder/route.ts
// Admin API: переставить Level с соседним (↑/↓). Меняет местами только order —
// содержимое обоих уровней не трогает.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { swapLevelOrder } from "@/lib/admin/ordering";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; levelId: string }> }
) {
  const { id: scenarioId, levelId } = await params;
  const body = await req.json().catch(() => ({}));
  const direction = body?.direction;

  if (direction !== "up" && direction !== "down") {
    return NextResponse.json({ error: "direction должен быть 'up' или 'down'" }, { status: 400 });
  }

  const level = await prisma.level.findFirst({ where: { id: levelId, scenarioId } });
  if (!level) {
    return NextResponse.json({ error: "Уровень не найден" }, { status: 404 });
  }

  const neighbor = await prisma.level.findFirst({
    where: {
      scenarioId,
      order: direction === "up" ? { lt: level.order } : { gt: level.order },
    },
    orderBy: { order: direction === "up" ? "desc" : "asc" },
  });

  if (!neighbor) {
    return NextResponse.json({ error: "Уровень уже крайний" }, { status: 400 });
  }

  await prisma.$transaction((tx) => swapLevelOrder(tx, level.id, neighbor.id));

  return NextResponse.json({ ok: true });
}
