// app/api/scenarios/[id]/levels/[levelId]/stages/[stageId]/route.ts
// Admin API: редактирование/удаление одного Stage.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateStageInput } from "@/lib/validation";
import { renumberStages } from "@/lib/admin/ordering";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; levelId: string; stageId: string }> }
) {
  const { levelId, stageId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const existing = await prisma.stage.findFirst({ where: { id: stageId, levelId } });
  if (!existing) {
    return NextResponse.json({ error: "Стадия не найдена" }, { status: 404 });
  }

  const input = {
    type: typeof body.type === "string" ? body.type : existing.type,
    title: body.title === undefined ? existing.title : typeof body.title === "string" ? body.title : null,
    description:
      body.description === undefined ? existing.description : typeof body.description === "string" ? body.description : null,
  };

  const errors = validateStageInput(input);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  const stage = await prisma.stage.update({
    where: { id: stageId },
    data: {
      type: input.type as "CONTACT" | "DISCOVERY" | "PITCH" | "OBJECTION" | "CLOSING",
      title: input.title,
      description: input.description,
    },
  });

  return NextResponse.json(stage);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; levelId: string; stageId: string }> }
) {
  const { levelId, stageId } = await params;

  const existing = await prisma.stage.findFirst({ where: { id: stageId, levelId } });
  if (!existing) {
    return NextResponse.json({ error: "Стадия не найдена" }, { status: 404 });
  }

  // Level с 0 стадий ломает Engine (advance-level требует хотя бы одну стадию у следующего
  // уровня — см. lib/engine/transition.ts::withAdvanceLevel) и необратимо "бьёт" любую сессию,
  // дошедшую до этого уровня. Проверено вживую: без этой проверки DELETE возвращал 200,
  // а следующий ход на такой сессии падал 500 с пустым телом ответа.
  const stageCount = await prisma.stage.count({ where: { levelId } });
  if (stageCount <= 1) {
    return NextResponse.json(
      { error: "Нельзя удалить последнюю стадию уровня — у уровня должна остаться хотя бы одна стадия" },
      { status: 409 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.stage.delete({ where: { id: stageId } });
    await renumberStages(tx, levelId);
  });

  return NextResponse.json({ ok: true });
}
