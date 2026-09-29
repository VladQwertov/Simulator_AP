// app/api/scenarios/[id]/levels/[levelId]/stages/[stageId]/reorder/route.ts
// Admin API: переставить Stage с соседней внутри того же Level (↑/↓).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { swapStageOrder } from "@/lib/admin/ordering";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; levelId: string; stageId: string }> }
) {
  const { levelId, stageId } = await params;
  const body = await req.json().catch(() => ({}));
  const direction = body?.direction;

  if (direction !== "up" && direction !== "down") {
    return NextResponse.json({ error: "direction должен быть 'up' или 'down'" }, { status: 400 });
  }

  const stage = await prisma.stage.findFirst({ where: { id: stageId, levelId } });
  if (!stage) {
    return NextResponse.json({ error: "Стадия не найдена" }, { status: 404 });
  }

  const neighbor = await prisma.stage.findFirst({
    where: {
      levelId,
      order: direction === "up" ? { lt: stage.order } : { gt: stage.order },
    },
    orderBy: { order: direction === "up" ? "desc" : "asc" },
  });

  if (!neighbor) {
    return NextResponse.json({ error: "Стадия уже крайняя" }, { status: 400 });
  }

  await prisma.$transaction((tx) => swapStageOrder(tx, stage.id, neighbor.id));

  return NextResponse.json({ ok: true });
}
