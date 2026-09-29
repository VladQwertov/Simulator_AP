import { beforeEach, describe, expect, it, vi } from "vitest";

const scenarioFindUnique = vi.fn();
const levelFindFirst = vi.fn();
const levelCount = vi.fn();
const sessionCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    scenario: { findUnique: (...args: unknown[]) => scenarioFindUnique(...args) },
    level: {
      findFirst: (...args: unknown[]) => levelFindFirst(...args),
      count: (...args: unknown[]) => levelCount(...args),
    },
    session: { create: (...args: unknown[]) => sessionCreate(...args) },
  },
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

const firstLevel = {
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
  stages: [{ order: 1, type: "CONTACT", title: "Контакт" }],
};

function request(body: unknown) {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  scenarioFindUnique.mockReset();
  levelFindFirst.mockReset();
  levelCount.mockReset();
  levelCount.mockResolvedValue(3);
  sessionCreate.mockReset();
});

describe("POST /api/sessions", () => {
  it("создаёт Session по конкретному scenarioId", async () => {
    scenarioFindUnique.mockResolvedValue(scenario);
    levelFindFirst.mockResolvedValue(firstLevel);
    sessionCreate.mockResolvedValue({ id: "sess_1" });

    const res = await POST(request({ scenarioId: "scn_1" }));
    const json = await res.json();

    expect(scenarioFindUnique).toHaveBeenCalledWith({ where: { id: "scn_1" } });
    expect(res.status).toBe(200);
    expect(json.sessionId).toBe("sess_1");
    expect(json.openingLine).toBe(firstLevel.openingLine);
  });

  it("отдаёт данные для отображения (Play UI): levelCount, названия Level/Stage, цель уровня", async () => {
    scenarioFindUnique.mockResolvedValue(scenario);
    levelFindFirst.mockResolvedValue(firstLevel);
    sessionCreate.mockResolvedValue({ id: "sess_1" });

    const res = await POST(request({ scenarioId: "scn_1" }));
    const json = await res.json();

    expect(json.scenarioTitle).toBe(scenario.title);
    expect(json.levelCount).toBe(3);
    expect(json.currentLevelTitle).toBe(firstLevel.title);
    expect(json.currentLevelObjective).toBe(firstLevel.objective);
    expect(json.currentStageTitle).toBe(firstLevel.stages[0].title);
  });

  it("грузит именно первый Level (order=1) сценария", async () => {
    scenarioFindUnique.mockResolvedValue(scenario);
    levelFindFirst.mockResolvedValue(firstLevel);
    sessionCreate.mockResolvedValue({ id: "sess_1" });

    await POST(request({ scenarioId: "scn_1" }));

    expect(levelFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scenarioId: "scn_1", order: 1 } })
    );
  });

  it("первый Turn создаётся с openingLine первого Level, а не через LLM", async () => {
    scenarioFindUnique.mockResolvedValue(scenario);
    levelFindFirst.mockResolvedValue(firstLevel);
    sessionCreate.mockResolvedValue({ id: "sess_1" });

    await POST(request({ scenarioId: "scn_1" }));

    const createArgs = sessionCreate.mock.calls[0][0];
    expect(createArgs.data.scenarioId).toBe("scn_1");
    expect(createArgs.data.turns.create[0]).toMatchObject({
      role: "OPPONENT",
      text: firstLevel.openingLine,
    });
    expect(createArgs.data.state.currentLevelOrder).toBe(1);
    expect(createArgs.data.state.currentStageOrder).toBe(1);
  });

  it("404, если сценарий не найден", async () => {
    scenarioFindUnique.mockResolvedValue(null);

    const res = await POST(request({ scenarioId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("400, если scenarioId не передан", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(400);
  });
});
