// app/api/scenarios/[id]/preview/route.ts
// Публично-безопасная проекция сценария для экрана контекста ПЕРЕД стартом переговоров
// (app/scenario/[id]/page.tsx). В отличие от GET /api/scenarios/:id (админский, полный —
// нужен для редактирования), этот эндпоинт НЕ отдаёт:
//  - opponentGoals — скрытые цели/возражения NPC, игрок не должен видеть их до переговоров;
//  - maxRounds/advanceThreshold/failThreshold — внутренние пороги движка;
//  - уровни 2+ — чтобы не спойлерить дальнейших персонажей/роли раньше времени.
// Раньше страница контекста дёргала админский эндпоинт напрямую, и opponentGoals был виден
// в сыром ответе (через вкладку Network), даже если React его не рендерил.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const scenario = await prisma.scenario.findUnique({
    where: { id },
    include: {
      levels: {
        orderBy: { order: "asc" },
        take: 1,
      },
    },
  });

  if (!scenario || !scenario.isPublished) {
    return NextResponse.json({ error: "Сценарий не найден" }, { status: 404 });
  }

  const firstLevel = scenario.levels[0] ?? null;

  return NextResponse.json({
    id: scenario.id,
    title: scenario.title,
    domain: scenario.domain,
    playerRole: scenario.playerRole,
    situation: scenario.situation,
    difficulty: scenario.difficulty,
    successCriteria: scenario.successCriteria,
    firstLevel: firstLevel && {
      title: firstLevel.title,
      opponentRole: firstLevel.opponentRole,
      opponentTone: firstLevel.opponentTone,
      objective: firstLevel.objective,
    },
  });
}
