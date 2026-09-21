// app/api/sessions/route.ts
// Создаёт новую сессию по первому опубликованному сценарию.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  const scenario = await prisma.scenario.findFirst({
    where: { isPublished: true },
  });

  if (!scenario) {
    return NextResponse.json(
      { error: "Нет ни одного сценария. Добавь его через Prisma Studio." },
      { status: 404 }
    );
  }

  const session = await prisma.session.create({
    data: {
      scenarioId: scenario.id,
      turns: {
        create: [{ role: "OPPONENT", text: scenario.openingLine }],
      },
    },
  });

  return NextResponse.json({
    sessionId: session.id,
    openingLine: scenario.openingLine,
  });
}
