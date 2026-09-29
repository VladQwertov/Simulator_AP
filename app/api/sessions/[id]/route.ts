// app/api/sessions/[id]/route.ts
// Play UI: чтение состояния сессии для первого рендера/перезагрузки страницы
// (POST /api/sessions и POST /turn возвращают то же самое сразу после мутации,
// этот GET нужен, чтобы открыть /play/[sessionId] напрямую без повторной игры).
// Только чтение — никакой игровой логики, только проекция уже посчитанного Engine state.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deriveOpponentMood, findStageByOrder } from "@/lib/engine";
import type { NegotiationState } from "@/lib/engine/types";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      scenario: {
        include: {
          levels: {
            orderBy: { order: "asc" },
            include: { stages: { orderBy: { order: "asc" } } },
          },
        },
      },
      turns: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  const state = session.state as unknown as NegotiationState;
  const currentLevel = session.scenario.levels.find((l) => l.order === state.currentLevelOrder);
  const currentStage = currentLevel ? findStageByOrder(currentLevel.stages, state.currentStageOrder, state.branch) : undefined;

  return NextResponse.json({
    sessionId: session.id,
    scenarioTitle: session.scenario.title,
    levelCount: session.scenario.levels.length,
    currentLevel: state.currentLevelOrder,
    currentLevelTitle: currentLevel?.title ?? null,
    currentLevelObjective: currentLevel?.objective ?? null,
    currentStage: state.currentStageOrder,
    currentStageTitle: currentStage?.title ?? currentStage?.type ?? null,
    round: state.round,
    maxRounds: state.maxRounds,
    outcome: state.negotiation.outcome,
    isEnding: session.status === "FINISHED",
    opponentMood: deriveOpponentMood(state.opponent.trust),
    turns: session.turns.map((t) => ({ role: t.role, text: t.text })),
  });
}
