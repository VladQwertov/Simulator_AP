import { beforeEach, describe, expect, it, vi } from "vitest";

const scenarioFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    scenario: { findUnique: (...args: unknown[]) => scenarioFindUnique(...args) },
  },
}));

const { GET } = await import("./route");

const routeParams = { params: Promise.resolve({ id: "scn_1" }) };

const scenarioWithHiddenData = {
  id: "scn_1",
  title: "Переговоры с директором",
  domain: "SaaS",
  playerRole: "Менеджер",
  situation: "Ситуация",
  difficulty: "MEDIUM",
  successCriteria: "Успех",
  isPublished: true,
  levels: [
    {
      title: "Менеджер по закупкам",
      opponentRole: "Менеджер по закупкам",
      opponentTone: "формальный",
      objective: "Пройти к ЛПР",
      opponentGoals: "СЕКРЕТНАЯ скрытая цель NPC",
      maxRounds: 16,
      advanceThreshold: 30,
      failThreshold: 20,
    },
  ],
};

beforeEach(() => {
  scenarioFindUnique.mockReset();
});

describe("GET /api/scenarios/[id]/preview", () => {
  it("не отдаёт opponentGoals и внутренние пороги движка", async () => {
    scenarioFindUnique.mockResolvedValue(scenarioWithHiddenData);

    const res = await GET(new Request("http://localhost"), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(JSON.stringify(json)).not.toContain("СЕКРЕТНАЯ");
    expect(json.firstLevel).toEqual({
      title: "Менеджер по закупкам",
      opponentRole: "Менеджер по закупкам",
      opponentTone: "формальный",
      objective: "Пройти к ЛПР",
    });
    expect(json.firstLevel.opponentGoals).toBeUndefined();
    expect(json.firstLevel.maxRounds).toBeUndefined();
    expect(json.firstLevel.advanceThreshold).toBeUndefined();
    expect(json.firstLevel.failThreshold).toBeUndefined();
  });

  it("404, если сценарий не найден", async () => {
    scenarioFindUnique.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost"), routeParams);
    expect(res.status).toBe(404);
  });

  it("404, если сценарий не опубликован (не только скрывает поля, но и не показывает сам факт существования)", async () => {
    scenarioFindUnique.mockResolvedValue({ ...scenarioWithHiddenData, isPublished: false });
    const res = await GET(new Request("http://localhost"), routeParams);
    expect(res.status).toBe(404);
  });
});
