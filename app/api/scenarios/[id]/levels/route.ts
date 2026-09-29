// app/api/scenarios/[id]/levels/route.ts
// Admin API: создание нового Level в конце списка сценария (order = max+1).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateLevelInput } from "@/lib/validation";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: scenarioId } = await params;
  const body = await req.json().catch(() => ({}));

  const scenario = await prisma.scenario.findUnique({ where: { id: scenarioId } });
  if (!scenario) {
    return NextResponse.json({ error: "Сценарий не найден" }, { status: 404 });
  }

  const input = {
    title: typeof body.title === "string" ? body.title : "Новый уровень",
    opponentRole: typeof body.opponentRole === "string" ? body.opponentRole : "",
    opponentTone: typeof body.opponentTone === "string" ? body.opponentTone : "",
    opponentGoals: typeof body.opponentGoals === "string" ? body.opponentGoals : "",
    objective: typeof body.objective === "string" ? body.objective : "Новая цель",
    openingLine: typeof body.openingLine === "string" ? body.openingLine : "...",
    maxRounds: Number.isFinite(body.maxRounds) ? Number(body.maxRounds) : 6,
    advanceThreshold: Number.isFinite(body.advanceThreshold) ? Number(body.advanceThreshold) : 70,
    failThreshold: Number.isFinite(body.failThreshold) ? Number(body.failThreshold) : 20,
  };

  const errors = validateLevelInput(input);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  const last = await prisma.level.findFirst({ where: { scenarioId }, orderBy: { order: "desc" } });
  const order = (last?.order ?? 0) + 1;

  const level = await prisma.level.create({
    data: { scenarioId, order, ...input },
    include: { stages: true },
  });

  return NextResponse.json(level, { status: 201 });
}
