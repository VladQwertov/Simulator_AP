import { beforeEach, describe, expect, it, vi } from "vitest";

const scenarioCreate = vi.fn();
const generateScenarioDraft = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    scenario: { create: (...args: unknown[]) => scenarioCreate(...args) },
  },
}));

vi.mock("@/lib/llm/client", () => ({
  generateScenarioDraft: (...args: unknown[]) => generateScenarioDraft(...args),
}));

const { POST } = await import("./route");

const validBody = {
  domain: "Аренда коммерческой недвижимости",
  difficulty: "MEDIUM",
  opponentRole: "Собственник помещения",
  opponentTone: "настороженный, торгуется по цене",
  opponentGoals: "Хочет максимальную ставку и минимальный ремонт за свой счёт",
};

const draft = {
  title: "Переговоры об аренде",
  playerRole: "Арендатор",
  situation: "Ищете помещение под офис.",
  successCriteria: "Подписан договор на приемлемых условиях",
  levels: [
    {
      title: "Первый контакт",
      opponentRole: "Собственник помещения",
      opponentTone: "настороженный",
      opponentGoals: "Максимальная ставка",
      objective: "Установить контакт",
      openingLine: "Слушаю вас.",
      stages: [
        { type: "CONTACT", title: "Контакт", description: "..." },
        { type: "DISCOVERY", title: "Понять ситуацию", description: "..." },
      ],
    },
    {
      title: "Закрытие",
      opponentRole: "Собственник помещения",
      opponentTone: "настороженный",
      opponentGoals: "Максимальная ставка",
      objective: "Закрыть сделку",
      openingLine: "По существу — что предлагаете?",
      stages: [{ type: "PITCH", title: "Предложение", description: "..." }],
    },
  ],
};

function request(body: unknown) {
  return new Request("http://localhost/api/scenarios/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  scenarioCreate.mockReset();
  generateScenarioDraft.mockReset();
  generateScenarioDraft.mockResolvedValue(draft);
  scenarioCreate.mockResolvedValue({ id: "scn1", ...draft });
});

describe("POST /api/scenarios/generate", () => {
  it("валидный контекст -> создаёт НЕопубликованный сценарий с посчитанным балансом по количеству стадий", async () => {
    const res = await POST(request(validBody));
    expect(res.status).toBe(201);

    expect(generateScenarioDraft).toHaveBeenCalledWith({
      domain: validBody.domain,
      difficulty: "MEDIUM",
      opponentRole: validBody.opponentRole,
      opponentTone: validBody.opponentTone,
      opponentGoals: validBody.opponentGoals,
    });

    const callArg = scenarioCreate.mock.calls[0][0];
    expect(callArg.data.isPublished).toBe(false);
    expect(callArg.data.domain).toBe(validBody.domain);
    expect(callArg.data.difficulty).toBe("MEDIUM");

    const levelsData = callArg.data.levels.create;
    expect(levelsData).toHaveLength(2);
    // level 1: 2 стадии -> maxRounds = 2*6+4 = 16; level 2: 1 стадия -> 1*6+4 = 10
    expect(levelsData[0]).toMatchObject({ order: 1, maxRounds: 16, advanceThreshold: 30, failThreshold: 20 });
    expect(levelsData[1]).toMatchObject({ order: 2, maxRounds: 10, advanceThreshold: 45, failThreshold: 20 });
    expect(levelsData[0].stages.create).toHaveLength(2);
    expect(levelsData[0].stages.create[0]).toMatchObject({ order: 1, type: "CONTACT" });
  });

  it("отсутствие обязательного поля -> 400, LLM не вызывается", async () => {
    const res = await POST(request({ ...validBody, opponentGoals: "" }));
    expect(res.status).toBe(400);
    expect(generateScenarioDraft).not.toHaveBeenCalled();
  });

  it("невалидный difficulty -> 400", async () => {
    const res = await POST(request({ ...validBody, difficulty: "EXTREME" }));
    expect(res.status).toBe(400);
  });

  it("некорректное тело запроса -> 400", async () => {
    const res = await POST(new Request("http://localhost/api/scenarios/generate", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });
});
