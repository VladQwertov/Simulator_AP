import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NegotiationState } from "@/lib/engine/types";

const sessionFindUnique = vi.fn();
const levelFindFirst = vi.fn();
const levelFindMany = vi.fn();
const levelCount = vi.fn();
const turnCreate = vi.fn();
const sessionUpdate = vi.fn();
const feedbackCreate = vi.fn();
const executeRaw = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/db", () => {
  // tx внутри $transaction — тот же набор моков, что и "верхний" prisma: в тестах нам не важна
  // настоящая изоляция транзакции, важно, что код вызывает те же методы через tx.*.
  const mockPrisma = {
    session: {
      findUnique: (...args: unknown[]) => sessionFindUnique(...args),
      update: (...args: unknown[]) => sessionUpdate(...args),
    },
    level: {
      findFirst: (...args: unknown[]) => levelFindFirst(...args),
      findMany: (...args: unknown[]) => levelFindMany(...args),
      count: (...args: unknown[]) => levelCount(...args),
    },
    turn: { create: (...args: unknown[]) => turnCreate(...args) },
    feedback: { create: (...args: unknown[]) => feedbackCreate(...args) },
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
  };

  return {
    prisma: {
      ...mockPrisma,
      $transaction: (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
    },
  };
});

const classifyAction = vi.fn();
const generateOpponentReply = vi.fn();
const generateFeedback = vi.fn();

vi.mock("@/lib/llm/client", () => ({
  classifyAction: (...args: unknown[]) => classifyAction(...args),
  generateOpponentReply: (...args: unknown[]) => generateOpponentReply(...args),
  generateFeedback: (...args: unknown[]) => generateFeedback(...args),
}));

const { POST } = await import("./route");

const scenario = {
  id: "scn_1",
  title: "Продажа CRM",
  domain: "B2B",
  difficulty: "MEDIUM",
  successCriteria: "Подписан договор",
  isPublished: true,
};

const level1 = {
  order: 1,
  title: "Менеджер",
  opponentRole: "Менеджер по закупкам",
  opponentTone: "деловой",
  opponentGoals: "Отсечь нецелевых поставщиков",
  objective: "Получить контакт ЛПР",
  openingLine: "Слушаю вас, что предлагаете?",
  maxRounds: 6,
  advanceThreshold: 70,
  failThreshold: 20,
  stages: [
    { order: 1, type: "CONTACT" },
    { order: 2, type: "DISCOVERY" },
  ],
};

const level2 = {
  order: 2,
  title: "ЛПР",
  opponentRole: "Директор по закупкам",
  opponentTone: "скептичный",
  opponentGoals: "Получить лучшую цену",
  objective: "Согласовать условия",
  openingLine: "Слушаю, что у вас за предложение по ценам?",
  maxRounds: 6,
  advanceThreshold: 60,
  failThreshold: 20,
  stages: [{ order: 1, type: "PITCH" }],
};

function baseState(overrides: Partial<NegotiationState> = {}): NegotiationState {
  return {
    currentLevelOrder: 1,
    currentStageOrder: 1,
    round: 0,
    maxRounds: 6,
    player: { concessions: 0, arguments: 0, questions: 0, pressure: 0, rapport: 0 },
    opponent: { trust: 50, resistance: 50, interest: 50, pressure: 0, hiddenGoals: "Отсечь нецелевых поставщиков" },
    stageProgress: { order: 1, type: "CONTACT", progress: 0, attempts: 0 },
    negotiation: { agreementProbability: 0, outcome: null },
    levelHistory: [],
    ...overrides,
  };
}

function makeSession(state: NegotiationState, extra: Record<string, unknown> = {}) {
  return {
    id: "sess_1",
    scenarioId: "scn_1",
    status: "IN_PROGRESS",
    state,
    scenario,
    turns: [],
    ...extra,
  };
}

function request(message: string) {
  return new Request("http://localhost/api/sessions/sess_1/turn", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

const routeParams = { params: Promise.resolve({ id: "sess_1" }) };

beforeEach(() => {
  sessionFindUnique.mockReset();
  levelFindFirst.mockReset();
  levelFindMany.mockReset();
  levelFindMany.mockResolvedValue([level1, level2]);
  levelCount.mockReset();
  levelCount.mockResolvedValue(2);
  turnCreate.mockReset();
  sessionUpdate.mockReset();
  feedbackCreate.mockReset();
  executeRaw.mockReset();
  executeRaw.mockResolvedValue(undefined);
  classifyAction.mockReset();
  generateOpponentReply.mockReset();
  generateFeedback.mockReset();
  generateFeedback.mockResolvedValue({
    summary: "s",
    strengths: "s",
    improvements: "i",
    keyMomentExplanation: "k",
    betterAnswer: "b",
    stageComments: [],
  });

  levelFindFirst.mockImplementation(async ({ where }: { where: { order: number } }) => {
    if (where.order === 1) return level1;
    if (where.order === 2) return level2;
    return null;
  });
});

describe("POST /api/sessions/[id]/turn", () => {
  it("classifyAction() возвращает ActionType, который Engine получает и сохраняет в Turn", async () => {
    sessionFindUnique.mockResolvedValue(makeSession(baseState()));
    classifyAction.mockResolvedValue({ actionType: "RAPPORT", quality: 77 });
    generateOpponentReply.mockResolvedValue("Приятно познакомиться.");

    await POST(request("Добрый день, рад знакомству"), routeParams);

    const userTurnCall = turnCreate.mock.calls.find((c) => c[0].data.role === "USER");
    expect(userTurnCall![0].data).toMatchObject({
      actionType: "RAPPORT",
      actionQuality: 77,
      levelOrder: 1,
      stageOrder: 1,
    });
  });

  it("continue: Engine не завершает сессию, ответ генерирует LLM", async () => {
    sessionFindUnique.mockResolvedValue(makeSession(baseState({ stageProgress: { order: 1, type: "CONTACT", progress: 10, attempts: 1 } })));
    classifyAction.mockResolvedValue({ actionType: "NEUTRAL", quality: 50 });
    generateOpponentReply.mockResolvedValue("Продолжайте.");

    const res = await POST(request("Ну ладно"), routeParams);
    const json = await res.json();

    expect(json.transition).toBe("continue");
    expect(json.isEnding).toBe(false);
    expect(json.opponentReply).toBe("Продолжайте.");
    expect(generateOpponentReply).toHaveBeenCalledTimes(1);
    expect(sessionUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "IN_PROGRESS" }) }));
    // currentStageTitle падает обратно на type, если у Stage не задан кастомный title.
    expect(json.currentStageTitle).toBe("CONTACT");
    expect(json.currentLevelTitle).toBe(level1.title);
    expect(json.scenarioTitle).toBe(scenario.title);
  });

  it("advance-stage: прогресс Stage уже завершён -> переход на следующую Stage внутри Level", async () => {
    sessionFindUnique.mockResolvedValue(
      makeSession(baseState({ stageProgress: { order: 1, type: "CONTACT", progress: 100, attempts: 3 } }))
    );
    classifyAction.mockResolvedValue({ actionType: "RAPPORT", quality: 60 });
    generateOpponentReply.mockResolvedValue("Ок, слушаю дальше.");

    const res = await POST(request("Перейдём к делу"), routeParams);
    const json = await res.json();

    expect(json.transition).toBe("advance-stage");
    expect(json.currentStage).toBe(2);
    expect(json.isEnding).toBe(false);
  });

  it("advance-level: следующая реплика NPC берётся из openingLine нового Level, LLM не вызывается для неё", async () => {
    sessionFindUnique.mockResolvedValue(
      makeSession(
        baseState({
          currentStageOrder: 2,
          stageProgress: { order: 2, type: "DISCOVERY", progress: 100, attempts: 2 },
          negotiation: { agreementProbability: 80, outcome: null },
        })
      )
    );
    classifyAction.mockResolvedValue({ actionType: "ARGUMENT", quality: 90 });

    const res = await POST(request("Вот наше предложение"), routeParams);
    const json = await res.json();

    expect(json.transition).toBe("advance-level");
    expect(json.currentLevel).toBe(2);
    expect(json.currentStage).toBe(1);
    expect(json.opponentReply).toBe(level2.openingLine);
    expect(generateOpponentReply).not.toHaveBeenCalled();
    expect(json.isEnding).toBe(false);
    // Данные для Play UI после перехода должны относиться к НОВОМУ уровню, а не к старому.
    expect(json.currentLevelTitle).toBe(level2.title);
    expect(json.currentLevelObjective).toBe(level2.objective);
    expect(json.levelCount).toBe(2);
  });

  it("advance-level: состояние NPC пересоздаётся для нового Level (не переносится из старого)", async () => {
    sessionFindUnique.mockResolvedValue(
      makeSession(
        baseState({
          currentStageOrder: 2,
          stageProgress: { order: 2, type: "DISCOVERY", progress: 100, attempts: 2 },
          opponent: { trust: 95, resistance: 5, interest: 95, pressure: 30, hiddenGoals: "Отсечь нецелевых поставщиков" },
          negotiation: { agreementProbability: 80, outcome: null },
        })
      )
    );
    classifyAction.mockResolvedValue({ actionType: "ARGUMENT", quality: 90 });

    await POST(request("Вот наше предложение"), routeParams);

    const updateArgs = sessionUpdate.mock.calls[0][0];
    const savedState = updateArgs.data.state as NegotiationState;
    expect(savedState.opponent).toEqual({ trust: 50, resistance: 50, interest: 50, pressure: 0, hiddenGoals: level2.opponentGoals });
  });

  it("fail-level (исчерпан лимит раундов) завершает Session и не даёт LLM решать исход", async () => {
    sessionFindUnique.mockResolvedValue(
      makeSession(baseState({ round: 5, maxRounds: 6, stageProgress: { order: 1, type: "CONTACT", progress: 10, attempts: 5 } }))
    );
    classifyAction.mockResolvedValue({ actionType: "NEUTRAL", quality: 50 });
    // LLM пытается вернуть свой overallScore=40 — должен быть проигнорирован.
    generateFeedback.mockResolvedValue({
      summary: "s",
      strengths: "s",
      improvements: "i",
      keyMomentExplanation: "k",
      betterAnswer: "b",
      stageComments: [],
      overallScore: 40,
    });

    const res = await POST(request("Мне пора идти"), routeParams);
    const json = await res.json();

    expect(json.transition).toBe("fail-level");
    expect(json.isEnding).toBe(true);
    expect(json.outcome).toBe("failed");
    expect(generateOpponentReply).not.toHaveBeenCalled();
    expect(sessionUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FINISHED" }) }));
    expect(feedbackCreate).toHaveBeenCalledTimes(1);
    expect(feedbackCreate.mock.calls[0][0].data.outcome).toBe("failed");
    // agreementProbability не менялась (NEUTRAL/quality=50) и осталась 0 -> calculateOverallScore([{finalScore:0}]) = 0.
    expect(feedbackCreate.mock.calls[0][0].data.overallScore).toBe(0);
  });

  it("fail-level (критический провал доверия) завершает Session независимо от раунда", async () => {
    sessionFindUnique.mockResolvedValue(
      makeSession(baseState({ round: 0, opponent: { trust: 10, resistance: 50, interest: 50, pressure: 0, hiddenGoals: "x" } }))
    );
    classifyAction.mockResolvedValue({ actionType: "PRESSURE", quality: 5 });
    generateFeedback.mockResolvedValue({
      summary: "s",
      strengths: "s",
      improvements: "i",
      keyMomentExplanation: "k",
      betterAnswer: "b",
      stageComments: [],
      overallScore: 10,
    });

    const res = await POST(request("Или вы соглашаетесь, или мы уходим"), routeParams);
    const json = await res.json();

    expect(json.transition).toBe("fail-level");
    expect(json.isEnding).toBe(true);
  });

  it("finish (последний Level, последняя Stage) завершает Session, исход не решает LLM", async () => {
    sessionFindUnique.mockResolvedValue(
      makeSession(
        baseState({
          currentLevelOrder: 2,
          currentStageOrder: 1,
          stageProgress: { order: 1, type: "PITCH", progress: 100, attempts: 2 },
          negotiation: { agreementProbability: 90, outcome: null },
        }),
        { scenario }
      )
    );
    classifyAction.mockResolvedValue({ actionType: "ARGUMENT", quality: 95 });
    // LLM пытается вернуть свой overallScore=90 — должен быть проигнорирован (реальный расчёт даёт 100).
    generateFeedback.mockResolvedValue({
      summary: "s",
      strengths: "s",
      improvements: "i",
      keyMomentExplanation: "k",
      betterAnswer: "b",
      stageComments: [],
      overallScore: 90,
    });

    const res = await POST(request("Готовы подписать на этих условиях"), routeParams);
    const json = await res.json();

    expect(json.transition).toBe("finish");
    expect(json.isEnding).toBe(true);
    expect(json.outcome).toBe("deal");
    expect(sessionUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FINISHED" }) }));
    expect(feedbackCreate).toHaveBeenCalledTimes(1);
    expect(feedbackCreate.mock.calls[0][0].data.outcome).toBe("deal");
    expect(feedbackCreate.mock.calls[0][0].data.overallScore).toBe(100);
  });

  it("overallScore в Feedback всегда детерминированный из levelHistory — рогue-значение от LLM игнорируется", async () => {
    sessionFindUnique.mockResolvedValue(
      makeSession(
        baseState({
          currentLevelOrder: 2,
          currentStageOrder: 1,
          stageProgress: { order: 1, type: "PITCH", progress: 100, attempts: 2 },
          negotiation: { agreementProbability: 90, outcome: null },
          // Уровень 1 уже пройден ранее с finalScore=80.
          levelHistory: [{ levelOrder: 1, title: "Менеджер", result: "advanced", roundsUsed: 4, finalScore: 80 }],
        }),
        { scenario }
      )
    );
    // quality=50 -> qualityDelta=0 -> agreementProbability не меняется (остаётся ровно 90),
    // поэтому итоговый levelHistory: [{finalScore:80}, {finalScore:90}] -> среднее = 85.
    classifyAction.mockResolvedValue({ actionType: "ARGUMENT", quality: 50 });
    generateFeedback.mockResolvedValue({
      summary: "s",
      strengths: "s",
      improvements: "i",
      keyMomentExplanation: "k",
      betterAnswer: "b",
      stageComments: [],
      overallScore: 1,
    });

    await POST(request("Финальные условия"), routeParams);

    expect(feedbackCreate).toHaveBeenCalledTimes(1);
    expect(feedbackCreate.mock.calls[0][0].data.overallScore).toBe(85);
  });

  it("classifyAction() физически не может повлиять на currentLevel/currentStage/outcome — Engine игнорирует всё, кроме actionType/quality", async () => {
    sessionFindUnique.mockResolvedValue(makeSession(baseState()));
    // Даже если бы classifyAction вернула лишние поля, роут читает из неё только actionType/quality
    // (тип ClassifyResult в lib/llm/client.ts не содержит ничего другого).
    classifyAction.mockResolvedValue({ actionType: "NEUTRAL", quality: 50 });
    generateOpponentReply.mockResolvedValue("Ок.");

    const res = await POST(request("Просто сообщение"), routeParams);
    const json = await res.json();

    expect(json.currentLevel).toBe(1);
    expect(json.currentStage).toBe(1);
    expect(json.outcome).toBeNull();
  });

  it("возвращает 400 без message и 404 без сессии", async () => {
    const resNoMessage = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({}) }), routeParams);
    expect(resNoMessage.status).toBe(400);

    sessionFindUnique.mockResolvedValue(null);
    const resNoSession = await POST(request("привет"), routeParams);
    expect(resNoSession.status).toBe(404);
  });

  it("возвращает 400, если сессия уже завершена", async () => {
    sessionFindUnique.mockResolvedValue(makeSession(baseState(), { status: "FINISHED" }));
    const res = await POST(request("привет"), routeParams);
    expect(res.status).toBe(400);
  });
});
