import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NegotiationState } from "@/lib/engine/types";

const sessionFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    session: { findUnique: (...args: unknown[]) => sessionFindUnique(...args) },
  },
}));

const { GET } = await import("./route");

const state: NegotiationState = {
  currentLevelOrder: 2,
  currentStageOrder: 1,
  round: 3,
  maxRounds: 8,
  player: { concessions: 0, arguments: 2, questions: 1, pressure: 0, rapport: 1 },
  opponent: { trust: 60, resistance: 40, interest: 55, pressure: 0, hiddenGoals: "x" },
  stageProgress: { order: 1, type: "PITCH", progress: 30, attempts: 1 },
  negotiation: { agreementProbability: 55, outcome: null },
  levelHistory: [{ levelOrder: 1, title: "Менеджер", result: "advanced", roundsUsed: 4, finalScore: 75 }],
};

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess_1",
    status: "IN_PROGRESS",
    state,
    scenario: {
      title: "Продажа CRM",
      levels: [
        { order: 1, title: "Менеджер", objective: "Получить контакт", stages: [{ order: 1, type: "CONTACT", title: "Контакт" }] },
        { order: 2, title: "ЛПР", objective: "Заинтересовать", stages: [{ order: 1, type: "PITCH", title: "Презентация" }] },
      ],
    },
    turns: [
      { role: "OPPONENT", text: "Слушаю вас." },
      { role: "USER", text: "Добрый день." },
    ],
    ...overrides,
  };
}

const routeParams = { params: Promise.resolve({ id: "sess_1" }) };

beforeEach(() => {
  sessionFindUnique.mockReset();
});

describe("GET /api/sessions/[id]", () => {
  it("404, если сессия не найдена", async () => {
    sessionFindUnique.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost"), routeParams);
    expect(res.status).toBe(404);
  });

  it("отдаёт текущий Level/Stage по order из state, а не по первому уровню сценария", async () => {
    sessionFindUnique.mockResolvedValue(makeSession());
    const res = await GET(new Request("http://localhost"), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.currentLevel).toBe(2);
    expect(json.currentLevelTitle).toBe("ЛПР");
    expect(json.currentLevelObjective).toBe("Заинтересовать");
    expect(json.currentStageTitle).toBe("Презентация");
    expect(json.levelCount).toBe(2);
    expect(json.round).toBe(3);
    expect(json.maxRounds).toBe(8);
  });

  it("отдаёт полную историю диалога", async () => {
    sessionFindUnique.mockResolvedValue(makeSession());
    const res = await GET(new Request("http://localhost"), routeParams);
    const json = await res.json();

    expect(json.turns).toEqual([
      { role: "OPPONENT", text: "Слушаю вас." },
      { role: "USER", text: "Добрый день." },
    ]);
  });

  it("isEnding true, если Session.status === FINISHED", async () => {
    sessionFindUnique.mockResolvedValue(makeSession({ status: "FINISHED" }));
    const res = await GET(new Request("http://localhost"), routeParams);
    const json = await res.json();

    expect(json.isEnding).toBe(true);
  });

  it("isEnding false для активной сессии", async () => {
    sessionFindUnique.mockResolvedValue(makeSession());
    const res = await GET(new Request("http://localhost"), routeParams);
    const json = await res.json();

    expect(json.isEnding).toBe(false);
  });
});
