// app/api/sessions/route.ts
// Создаёт новую сессию по конкретному scenarioId: грузит Scenario -> первый Level -> его Stage[],
// строит начальный NegotiationState через createInitialState и создаёт Session с первым Turn
// (Level.openingLine, без обращения к LLM).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createInitialState, deriveOpponentMood } from "@/lib/engine";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const scenarioId = body?.scenarioId;

  if (!scenarioId || typeof scenarioId !== "string") {
    return NextResponse.json({ error: "Нужно поле scenarioId" }, { status: 400 });
  }

  const scenario = await prisma.scenario.findUnique({ where: { id: scenarioId } });
  if (!scenario || !scenario.isPublished) {
    return NextResponse.json({ error: "Сценарий не найден или не опубликован" }, { status: 404 });
  }

  const firstLevel = await prisma.level.findFirst({
    where: { scenarioId: scenario.id, order: 1 },
    include: { stages: { orderBy: { order: "asc" } } },
  });

  if (!firstLevel || firstLevel.stages.length === 0) {
    return NextResponse.json(
      { error: "У сценария нет настроенного первого уровня со стадиями" },
      { status: 500 }
    );
  }

  const initialState = createInitialState(firstLevel);
  const levelCount = await prisma.level.count({ where: { scenarioId: scenario.id } });
  const firstStage = firstLevel.stages[0];

  const session = await prisma.session.create({
    data: {
      scenarioId: scenario.id,
      state: initialState as unknown as object,
      turns: {
        create: [{ role: "OPPONENT", text: firstLevel.openingLine, levelOrder: firstLevel.order, stageOrder: firstStage.order }],
      },
    },
  });

  return NextResponse.json({
    sessionId: session.id,
    scenarioTitle: scenario.title,
    openingLine: firstLevel.openingLine,
    levelCount,
    currentLevel: initialState.currentLevelOrder,
    currentLevelTitle: firstLevel.title,
    currentLevelObjective: firstLevel.objective,
    currentStage: initialState.currentStageOrder,
    currentStageTitle: firstStage.title ?? firstStage.type,
    round: initialState.round,
    maxRounds: initialState.maxRounds,
    opponentMood: deriveOpponentMood(initialState.opponent.trust),
  });
}
