// app/api/scenarios/generate/route.ts
// Конфигурируемость под контекст (ТЗ п.2): администратор задаёт сферу/тему, сложность, тон/роль/
// цели оппонента — этот эндпоинт генерирует по ним полный черновик сценария (LLM пишет контент,
// см. lib/llm/prompts.ts::buildScenarioDraftPrompt) и создаёт его как НЕопубликованный, чтобы
// администратор проверил/поправил перед публикацией в обычном редакторе (/admin/scenarios/[id]).
//
// Числа баланса (maxRounds/advanceThreshold/failThreshold) считает ЭТОТ роут детерминированно по
// количеству стадий — не LLM: та же логика "Engine решает баланс, LLM пишет только контент", что
// и во всём остальном движке (lib/engine/*). Формула калибрована по живым прогонам на реальной
// (не MOCK) LLM в этом проекте: на них 3-этапный level c maxRounds=16 не успевал закрыться даже
// при близкой к идеальной игре, 22 раунда — уже успевало.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateScenarioDraft } from "@/lib/llm/client";

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;

const ROUNDS_PER_STAGE = 6;
const ROUNDS_BUFFER = 4;
const BASE_ADVANCE_THRESHOLD = 30;
const ADVANCE_THRESHOLD_STEP = 15;
const MAX_ADVANCE_THRESHOLD = 60;
const FAIL_THRESHOLD = 20;

function computeLevelBalance(order: number, stageCount: number) {
  return {
    maxRounds: stageCount * ROUNDS_PER_STAGE + ROUNDS_BUFFER,
    advanceThreshold: Math.min(BASE_ADVANCE_THRESHOLD + (order - 1) * ADVANCE_THRESHOLD_STEP, MAX_ADVANCE_THRESHOLD),
    failThreshold: FAIL_THRESHOLD,
  };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const domain = typeof body.domain === "string" ? body.domain.trim() : "";
  const difficulty = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : null;
  const opponentRole = typeof body.opponentRole === "string" ? body.opponentRole.trim() : "";
  const opponentTone = typeof body.opponentTone === "string" ? body.opponentTone.trim() : "";
  const opponentGoals = typeof body.opponentGoals === "string" ? body.opponentGoals.trim() : "";

  const errors: string[] = [];
  if (!domain) errors.push("domain не может быть пустым");
  if (!difficulty) errors.push("difficulty должен быть одним из: " + DIFFICULTIES.join(", "));
  if (!opponentRole) errors.push("opponentRole не может быть пустым");
  if (!opponentTone) errors.push("opponentTone не может быть пустым");
  if (!opponentGoals) errors.push("opponentGoals не может быть пустым");
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  const draft = await generateScenarioDraft({ domain, difficulty: difficulty!, opponentRole, opponentTone, opponentGoals });

  const scenario = await prisma.scenario.create({
    data: {
      title: draft.title,
      domain,
      playerRole: draft.playerRole,
      situation: draft.situation,
      difficulty: difficulty!,
      successCriteria: draft.successCriteria,
      isPublished: false, // черновик — администратор проверяет и публикует вручную в редакторе
      levels: {
        create: draft.levels.map((level, i) => {
          const order = i + 1;
          const balance = computeLevelBalance(order, level.stages.length);
          return {
            order,
            title: level.title,
            opponentRole: level.opponentRole,
            opponentTone: level.opponentTone,
            opponentGoals: level.opponentGoals,
            objective: level.objective,
            openingLine: level.openingLine,
            maxRounds: balance.maxRounds,
            advanceThreshold: balance.advanceThreshold,
            failThreshold: balance.failThreshold,
            stages: {
              create: level.stages.map((stage, j) => ({
                order: j + 1,
                type: stage.type,
                title: stage.title,
                description: stage.description,
              })),
            },
          };
        }),
      },
    },
    include: { levels: { include: { stages: true } } },
  });

  return NextResponse.json(scenario, { status: 201 });
}
