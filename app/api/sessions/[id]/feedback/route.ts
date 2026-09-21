// app/api/sessions/[id]/feedback/route.ts
// Отдаёт уже сгенерированный фидбек (генерируется в turn/route.ts при завершении).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const feedback = await prisma.feedback.findUnique({
    where: { sessionId: id },
  });

  if (!feedback) {
    return NextResponse.json({ error: "Фидбек ещё не готов" }, { status: 404 });
  }

  return NextResponse.json(feedback);
}
