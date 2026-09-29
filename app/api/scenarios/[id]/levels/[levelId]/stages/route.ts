// app/api/scenarios/[id]/levels/[levelId]/stages/route.ts
// Admin API: создание нового Stage в конце списка уровня (order = max+1).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateStageInput } from "@/lib/validation";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; levelId: string }> }
) {
  const { id: scenarioId, levelId } = await params;
  const body = await req.json().catch(() => ({}));

  const level = await prisma.level.findFirst({ where: { id: levelId, scenarioId } });
  if (!level) {
    return NextResponse.json({ error: "Уровень не найден" }, { status: 404 });
  }

  const input = {
    type: typeof body.type === "string" ? body.type : "",
    title: typeof body.title === "string" ? body.title : null,
    description: typeof body.description === "string" ? body.description : null,
  };

  const errors = validateStageInput(input);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  const last = await prisma.stage.findFirst({ where: { levelId }, orderBy: { order: "desc" } });
  const order = (last?.order ?? 0) + 1;

  const stage = await prisma.stage.create({
    data: {
      levelId,
      order,
      type: input.type as "CONTACT" | "DISCOVERY" | "PITCH" | "OBJECTION" | "CLOSING",
      title: input.title,
      description: input.description,
    },
  });

  return NextResponse.json(stage, { status: 201 });
}
