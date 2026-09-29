// app/api/scenarios/[id]/route.ts
// Admin API: чтение/редактирование/удаление одного Scenario вместе с Level->Stage.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validatePublishReady, validateScenarioInput } from "@/lib/validation";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const scenario = await prisma.scenario.findUnique({
    where: { id },
    include: {
      levels: {
        orderBy: { order: "asc" },
        include: { stages: { orderBy: { order: "asc" } } },
      },
    },
  });

  if (!scenario) {
    return NextResponse.json({ error: "Сценарий не найден" }, { status: 404 });
  }

  return NextResponse.json(scenario);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const existing = await prisma.scenario.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Сценарий не найден" }, { status: 404 });
  }

  const title = typeof body.title === "string" ? body.title : existing.title;
  const domain = typeof body.domain === "string" ? body.domain : existing.domain;
  const playerRole = typeof body.playerRole === "string" ? body.playerRole : existing.playerRole;
  const situation = typeof body.situation === "string" ? body.situation : existing.situation;
  const difficulty = ["EASY", "MEDIUM", "HARD"].includes(body.difficulty) ? body.difficulty : existing.difficulty;
  const successCriteria = typeof body.successCriteria === "string" ? body.successCriteria : existing.successCriteria;
  const isPublished = typeof body.isPublished === "boolean" ? body.isPublished : existing.isPublished;

  const errors = validateScenarioInput({ title, domain, successCriteria, playerRole, situation });
  if (isPublished) errors.push(...validatePublishReady({ successCriteria, playerRole, situation }));
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  const scenario = await prisma.scenario.update({
    where: { id },
    data: { title, domain, playerRole, situation, difficulty, successCriteria, isPublished },
  });

  return NextResponse.json(scenario);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await prisma.scenario.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Сценарий не найден" }, { status: 404 });
  }

  const sessionCount = await prisma.session.count({ where: { scenarioId: id } });
  if (sessionCount > 0) {
    return NextResponse.json(
      { error: "Нельзя удалить сценарий: по нему уже есть сессии" },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.stage.deleteMany({ where: { level: { scenarioId: id } } }),
    prisma.level.deleteMany({ where: { scenarioId: id } }),
    prisma.scenario.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
