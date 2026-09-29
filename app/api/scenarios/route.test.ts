import { beforeEach, describe, expect, it, vi } from "vitest";

const scenarioFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    scenario: { findMany: (...args: unknown[]) => scenarioFindMany(...args) },
  },
}));

const { GET } = await import("./route");

beforeEach(() => {
  scenarioFindMany.mockReset();
  scenarioFindMany.mockResolvedValue([]);
});

describe("GET /api/scenarios", () => {
  it("без параметра ?published отдаёт все сценарии (для Admin)", async () => {
    await GET(new Request("http://localhost/api/scenarios"));
    expect(scenarioFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });

  it("?published=true фильтрует только опубликованные (для Play UI)", async () => {
    await GET(new Request("http://localhost/api/scenarios?published=true"));
    expect(scenarioFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isPublished: true } }));
  });
});
