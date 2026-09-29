// Отдельный файл: здесь НЕ мокается lib/llm/client — используется настоящий модуль
// с MOCK_LLM=true, чтобы доказать, что весь цикл (classify -> Engine -> reply -> feedback)
// реально проходит целиком без единого обращения к внешнему API.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NegotiationState } from "@/lib/engine/types";

const sessionFindUnique = vi.fn();
const levelFindFirst = vi.fn();
const levelCount = vi.fn();
const turnCreate = vi.fn();
const sessionUpdate = vi.fn();
const feedbackCreate = vi.fn();
const executeRaw = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    session: {
      findUnique: (...args: unknown[]) => sessionFindUnique(...args),
      update: (...args: unknown[]) => sessionUpdate(...args),
    },
    level: {
      findFirst: (...args: unknown[]) => levelFindFirst(...args),
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
  stages: [{ order: 1, type: "CONTACT" }],
};

function baseState(): NegotiationState {
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
  vi.stubEnv("MOCK_LLM", "true");
  sessionFindUnique.mockReset();
  levelFindFirst.mockReset();
  levelCount.mockReset();
  levelCount.mockResolvedValue(1);
  turnCreate.mockReset();
  sessionUpdate.mockReset();
  feedbackCreate.mockReset();
  executeRaw.mockReset();
  executeRaw.mockResolvedValue(undefined);
  levelFindFirst.mockImplementation(async ({ where }: { where: { order: number } }) => (where.order === 1 ? level1 : null));
  sessionFindUnique.mockResolvedValue({
    id: "sess_1",
    scenarioId: "scn_1",
    status: "IN_PROGRESS",
    state: baseState(),
    scenario,
    turns: [],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/sessions/[id]/turn c MOCK_LLM=true", () => {
  it("проходит полный ход без сети: classify (fallback) -> Engine -> reply (fallback)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(request("Добрый день! Расскажите, что вас интересует?"), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(typeof json.opponentReply).toBe("string");
    expect(json.opponentReply.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(turnCreate).toHaveBeenCalledTimes(2); // USER + OPPONENT
    expect(sessionUpdate).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
