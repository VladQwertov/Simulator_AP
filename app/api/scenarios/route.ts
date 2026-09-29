// app/api/scenarios/route.ts
// Admin API: список и создание Scenario. Только конфигурация — никакой игровой логики.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validatePublishReady, validateScenarioInput } from "@/lib/validation";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const publishedOnly = searchParams.get("published") === "true";

  const scenarios = await prisma.scenario.findMany({
    where: publishedOnly ? { isPublished: true } : undefined,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { levels: true } } },
  });

  return NextResponse.json(
    scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      domain: s.domain,
      playerRole: s.playerRole,
      situation: s.situation,
      difficulty: s.difficulty,
      successCriteria: s.successCriteria,
      isPublished: s.isPublished,
      levelCount: s._count.levels,
    }))
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const title = body.title;
  const domain = typeof body.domain === "string" ? body.domain : "";
  const playerRole = typeof body.playerRole === "string" ? body.playerRole : "";
  const situation = typeof body.situation === "string" ? body.situation : "";
  const difficulty = ["EASY", "MEDIUM", "HARD"].includes(body.difficulty) ? body.difficulty : "MEDIUM";
  const successCriteria = typeof body.successCriteria === "string" ? body.successCriteria : "";
  const isPublished = typeof body.isPublished === "boolean" ? body.isPublished : false;

  const errors = validateScenarioInput({ title, domain, successCriteria, playerRole, situation });
  if (isPublished) errors.push(...validatePublishReady({ successCriteria, playerRole, situation }));
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  const scenario = await prisma.scenario.create({
    data: { title, domain, playerRole, situation, difficulty, successCriteria, isPublished },
  });

  return NextResponse.json(scenario, { status: 201 });
}
