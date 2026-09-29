// app/api/sessions/[id]/turn/route.ts
// Принимает реплику игрока:
//  1. classifyAction() — LLM классифицирует реплику (actionType/quality), ничего не решает;
//  2. processTurn() — детерминированный Engine считает новый state и transition;
//  3. в зависимости от transition: LLM-реплика (continue/advance-stage), openingLine нового
//     Level (advance-level, без LLM) или детерминированная закрывающая фраза (fail-level/finish);
//  4. если isEnding — Engine считает stageBreakdown/keyMoment из уже сохранённых Turn,
//     LLM (generateFeedback) только облекает эти факты в текст.
//
// Вся работа с БД для одного хода обёрнута в одну транзакцию с advisory-lock по id сессии
// (pg_advisory_xact_lock) — это сериализует конкурентные запросы к ОДНОЙ и той же сессии
// (например, двойной клик "Отправить"), не блокируя запросы к другим сессиям. Без этого два
// одновременных запроса читали одно и то же состояние, оба создавали Turn (реплика дублировалась
// в истории) и один падал на уникальном ограничении Feedback.sessionId — воспроизведено вживую.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { classifyAction, generateFeedback, generateOpponentReply } from "@/lib/llm/client";
import { buildStageBreakdown, calculateOverallScore, deriveOpponentMood, pickKeyMoment, processTurn } from "@/lib/engine";
import type { FeedbackTurnFact, NegotiationOutcome, NegotiationState, StageType } from "@/lib/engine";
import type { HistoryTurn } from "@/lib/llm/prompts";

// LLM-вызовы внутри транзакции могут занимать несколько секунд суммарно — дефолтный таймаут
// Prisma (5с) этого не переживёт. Значения ниже с большим запасом.
const TRANSACTION_TIMEOUT_MS = 20000;
const TRANSACTION_MAX_WAIT_MS = 10000;

class RouteError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function closingReply(outcome: NegotiationOutcome | null): string {
  switch (outcome) {
    case "deal":
      return "Договорились. Уверен, сотрудничество будет успешным.";
    case "partial":
      return "Не всё, что хотелось, но по ключевым пунктам мы сошлись.";
    case "failed":
    default:
      return "Боюсь, в этот раз нам не удалось договориться.";
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { message } = await req.json().catch(() => ({ message: null }));

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Нужно поле message" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Сериализация конкурентных запросов к ОДНОЙ сессии. Второй одновременный запрос
        // (например, второй клик "Отправить") дождётся коммита первого и увидит уже
        // обновлённое/завершённое состояние вместо гонки за чтение-запись.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`;

        const session = await tx.session.findUnique({
          where: { id },
          include: { scenario: true, turns: { orderBy: { createdAt: "asc" } } },
        });

        if (!session) {
          throw new RouteError(404, "Сессия не найдена");
        }
        if (session.status === "FINISHED") {
          throw new RouteError(400, "Сессия уже завершена");
        }

        const state = session.state as unknown as NegotiationState;

        const [level, nextLevel, levelCount] = await Promise.all([
          tx.level.findFirst({
            where: { scenarioId: session.scenarioId, order: state.currentLevelOrder },
            include: { stages: { orderBy: { order: "asc" } } },
          }),
          tx.level.findFirst({
            where: { scenarioId: session.scenarioId, order: state.currentLevelOrder + 1 },
            include: { stages: { orderBy: { order: "asc" } } },
          }),
          tx.level.count({ where: { scenarioId: session.scenarioId } }),
        ]);

        if (!level) {
          throw new RouteError(500, "Текущий уровень сценария не найден");
        }

        const stage = level.stages.find((s) => s.order === state.currentStageOrder);
        if (!stage) {
          throw new RouteError(500, "Текущая стадия уровня не найдена");
        }

        const history: HistoryTurn[] = session.turns.map((t) => ({
          role: t.role,
          text: t.text,
          actionType: t.actionType,
          actionQuality: t.actionQuality,
        }));

        // 1. Классификация реплики игрока — только actionType/quality, никаких решений об исходе.
        // (В т.ч. ABUSE/GIBBERISH/OFF_TOPIC — тоже просто классификация, не решение.)
        const { actionType, quality } = await classifyAction({
          scenario: session.scenario,
          level,
          stage,
          history,
          lastUserMessage: message,
        });

        // 2. Детерминированный Engine решает всё остальное.
        const { state: newState, transition, isEnding } = processTurn({
          state,
          level,
          nextLevel,
          actionType,
          quality,
        });

        await tx.turn.create({
          data: {
            sessionId: session.id,
            role: "USER",
            text: message,
            levelOrder: state.currentLevelOrder,
            stageOrder: state.currentStageOrder,
            actionType,
            actionQuality: quality,
          },
        });

        // 3. Реплика оппонента: LLM — только внутри уровня; переход/финал — детерминированно.
        let opponentReply: string;
        if (transition === "advance-level") {
          if (!nextLevel) {
            throw new RouteError(500, "Engine вернул advance-level без nextLevel — рассинхронизация данных");
          }
          opponentReply = nextLevel.openingLine;
        } else if (transition === "continue" || transition === "advance-stage") {
          opponentReply = await generateOpponentReply({
            scenario: session.scenario,
            level,
            stage,
            state: newState,
            actionType,
            history,
            lastUserMessage: message,
          });
        } else {
          // fail-level | finish — исход уже решён движком, LLM здесь не участвует.
          opponentReply = closingReply(newState.negotiation.outcome);
        }

        await tx.turn.create({
          data: {
            sessionId: session.id,
            role: "OPPONENT",
            text: opponentReply,
            levelOrder: newState.currentLevelOrder,
            stageOrder: newState.currentStageOrder,
          },
        });

        await tx.session.update({
          where: { id: session.id },
          data: {
            state: newState as unknown as object,
            status: isEnding ? "FINISHED" : "IN_PROGRESS",
          },
        });

        // 4. Feedback: все цифры/выбор ключевой реплики — детерминированные Engine-факты
        // (lib/engine/feedbackFacts.ts), LLM пишет только текст поверх них.
        if (isEnding) {
          const outcome = newState.negotiation.outcome ?? "failed";
          const overallScore = calculateOverallScore(newState.levelHistory);

          const allLevels = await tx.level.findMany({
            where: { scenarioId: session.scenarioId },
            select: { order: true, stages: { select: { order: true, type: true } } },
          });
          const resolveStageType = (levelOrder: number | null, stageOrder: number | null): StageType | null => {
            if (levelOrder == null || stageOrder == null) return null;
            const lvl = allLevels.find((l) => l.order === levelOrder);
            return lvl?.stages.find((s) => s.order === stageOrder)?.type ?? null;
          };

          const feedbackTurns: FeedbackTurnFact[] = [
            ...session.turns.map((t) => ({
              role: t.role,
              text: t.text,
              actionType: t.actionType,
              actionQuality: t.actionQuality,
              stageType: resolveStageType(t.levelOrder, t.stageOrder),
            })),
            {
              role: "USER" as const,
              text: message,
              actionType,
              actionQuality: quality,
              stageType: resolveStageType(state.currentLevelOrder, state.currentStageOrder),
            },
            { role: "OPPONENT" as const, text: opponentReply, actionType: null, actionQuality: null, stageType: null },
          ];

          const stageBreakdown = buildStageBreakdown(feedbackTurns);
          const keyMoment = pickKeyMoment(feedbackTurns, outcome);

          const fullHistory: HistoryTurn[] = [
            ...history,
            { role: "USER", text: message, actionType, actionQuality: quality },
            { role: "OPPONENT", text: opponentReply },
          ];

          const feedbackResult = await generateFeedback({
            scenario: session.scenario,
            levelHistory: newState.levelHistory,
            history: fullHistory,
            outcome,
            overallScore,
            stageBreakdown,
            keyMoment,
          });

          const stageBreakdownWithComments = stageBreakdown.map((s) => ({
            ...s,
            comment: feedbackResult.stageComments.find((c) => c.label === s.label)?.comment ?? "",
          }));

          await tx.feedback.create({
            data: {
              sessionId: session.id,
              outcome,
              perLevelBreakdown: newState.levelHistory as unknown as object,
              stageBreakdown: stageBreakdownWithComments as unknown as object,
              keyMomentQuote: keyMoment?.quote ?? null,
              keyMomentExplanation: feedbackResult.keyMomentExplanation,
              betterAnswer: feedbackResult.betterAnswer,
              summary: feedbackResult.summary,
              strengths: feedbackResult.strengths,
              improvements: feedbackResult.improvements,
              overallScore,
            },
          });
        }

        // Для отображения (Play UI): после advance-level "текущий" уровень — это nextLevel,
        // иначе — тот же level, но, возможно, другая (следующая) Stage внутри него.
        const displayLevel = transition === "advance-level" ? nextLevel! : level;
        const displayStage = displayLevel.stages.find((s) => s.order === newState.currentStageOrder);

        return {
          opponentReply,
          transition,
          scenarioTitle: session.scenario.title,
          levelCount,
          currentLevel: newState.currentLevelOrder,
          currentLevelTitle: displayLevel.title,
          currentLevelObjective: displayLevel.objective,
          currentStage: newState.currentStageOrder,
          currentStageTitle: displayStage?.title ?? displayStage?.type ?? null,
          round: newState.round,
          maxRounds: newState.maxRounds,
          outcome: newState.negotiation.outcome,
          isEnding,
          opponentMood: deriveOpponentMood(newState.opponent.trust),
        };
      },
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS }
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RouteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // Никогда не отдаём пустое тело/сырой стек наружу — всегда валидный JSON с понятной ошибкой.
    console.error("POST /api/sessions/[id]/turn упал:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера. Попробуйте отправить сообщение ещё раз." },
      { status: 500 }
    );
  }
}
