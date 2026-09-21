// app/api/sessions/[id]/turn/route.ts
// Принимает реплику игрока, вызывает судью, сохраняет ход.
// Если переговоры завершились этим ходом — сразу генерирует фидбек.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { judgeTurn, generateFeedback } from "@/lib/llm/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { message } = await req.json();

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Нужно поле message" }, { status: 400 });
  }

  const session = await prisma.session.findUnique({
    where: { id },
    include: { scenario: true, turns: { orderBy: { createdAt: "asc" } } },
  });

  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }
  if (session.status === "FINISHED") {
    return NextResponse.json({ error: "Сессия уже завершена" }, { status: 400 });
  }

  const history = session.turns.map((t) => ({
    role: t.role,
    text: t.text,
  }));

  const result = await judgeTurn({
    scenario: session.scenario,
    history,
    lastUserMessage: message,
  });

  await prisma.turn.create({
    data: {
      sessionId: session.id,
      role: "USER",
      text: message,
      score: result.score,
      scoreNotes: result.comment,
    },
  });
  await prisma.turn.create({
    data: { sessionId: session.id, role: "OPPONENT", text: result.opponentReply },
  });

  if (result.isEnding) {
    await prisma.session.update({
      where: { id: session.id },
      data: { status: "FINISHED" },
    });

    const outcome = result.endingOutcome ?? "partial";
    const fullHistory = [
      ...history,
      { role: "USER" as const, text: message, score: result.score },
      { role: "OPPONENT" as const, text: result.opponentReply },
    ];

    const feedbackResult = await generateFeedback({
      scenario: session.scenario,
      history: fullHistory,
      outcome,
    });

    await prisma.feedback.create({
      data: { sessionId: session.id, outcome, ...feedbackResult },
    });
  }

  return NextResponse.json({
    opponentReply: result.opponentReply,
    score: result.score,
    comment: result.comment,
    isEnding: result.isEnding,
  });
}
