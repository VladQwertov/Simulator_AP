import { beforeEach, describe, expect, it, vi } from "vitest";

const levelFindFirst = vi.fn();
const levelCount = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    level: {
      findFirst: (...args: unknown[]) => levelFindFirst(...args),
      count: (...args: unknown[]) => levelCount(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

vi.mock("@/lib/admin/ordering", () => ({
  renumberLevels: vi.fn(),
}));

const { DELETE } = await import("./route");

const routeParams = { params: Promise.resolve({ id: "scn_1", levelId: "lvl_1" }) };

beforeEach(() => {
  levelFindFirst.mockReset();
  levelCount.mockReset();
  transaction.mockReset();
});

describe("DELETE .../levels/[levelId]", () => {
  it("нельзя удалить последний уровень сценария", async () => {
    levelFindFirst.mockResolvedValue({ id: "lvl_1", scenarioId: "scn_1" });
    levelCount.mockResolvedValue(1);

    const res = await DELETE(new Request("http://localhost"), routeParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/последний уровень/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("можно удалить уровень, если в сценарии их больше одного", async () => {
    levelFindFirst.mockResolvedValue({ id: "lvl_1", scenarioId: "scn_1" });
    levelCount.mockResolvedValue(2);
    transaction.mockResolvedValue(undefined);

    const res = await DELETE(new Request("http://localhost"), routeParams);

    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("404, если уровень не найден", async () => {
    levelFindFirst.mockResolvedValue(null);
    const res = await DELETE(new Request("http://localhost"), routeParams);
    expect(res.status).toBe(404);
  });
});
