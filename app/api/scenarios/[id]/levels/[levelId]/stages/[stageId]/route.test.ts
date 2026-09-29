import { beforeEach, describe, expect, it, vi } from "vitest";

const stageFindFirst = vi.fn();
const stageCount = vi.fn();
const stageUpdate = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    stage: {
      findFirst: (...args: unknown[]) => stageFindFirst(...args),
      count: (...args: unknown[]) => stageCount(...args),
      update: (...args: unknown[]) => stageUpdate(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

vi.mock("@/lib/admin/ordering", () => ({
  renumberStages: vi.fn(),
}));

const { DELETE } = await import("./route");

const routeParams = { params: Promise.resolve({ id: "scn_1", levelId: "lvl_1", stageId: "stg_1" }) };

beforeEach(() => {
  stageFindFirst.mockReset();
  stageCount.mockReset();
  transaction.mockReset();
});

describe("DELETE .../stages/[stageId]", () => {
  it("нельзя удалить последнюю стадию уровня", async () => {
    stageFindFirst.mockResolvedValue({ id: "stg_1", levelId: "lvl_1" });
    stageCount.mockResolvedValue(1);

    const res = await DELETE(new Request("http://localhost"), routeParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/последнюю стадию/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("можно удалить стадию, если в уровне их больше одной", async () => {
    stageFindFirst.mockResolvedValue({ id: "stg_1", levelId: "lvl_1" });
    stageCount.mockResolvedValue(3);
    transaction.mockResolvedValue(undefined);

    const res = await DELETE(new Request("http://localhost"), routeParams);

    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("404, если стадия не найдена", async () => {
    stageFindFirst.mockResolvedValue(null);
    const res = await DELETE(new Request("http://localhost"), routeParams);
    expect(res.status).toBe(404);
  });
});
