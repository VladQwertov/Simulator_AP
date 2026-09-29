import { describe, expect, it } from "vitest";
import { clamp, findStageByOrder } from "./util";
import { makeStage } from "./test-fixtures";

describe("clamp", () => {
  it("держит значение в границах [min, max]", () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(-10, 0, 100)).toBe(0);
    expect(clamp(50, 0, 100)).toBe(50);
  });
});

describe("findStageByOrder", () => {
  const stages = [
    makeStage({ order: 1, type: "CONTACT" }),
    makeStage({ order: 2, type: "OBJECTION", branchKey: "soft" }),
    makeStage({ order: 2, type: "OBJECTION", branchKey: "hard" }),
    makeStage({ order: 3, type: "CLOSING" }),
  ];

  it("вне развилки находит единственный Stage независимо от branch", () => {
    expect(findStageByOrder(stages, 1, null)).toEqual(stages[0]);
    expect(findStageByOrder(stages, 1, "hard")).toEqual(stages[0]);
    expect(findStageByOrder(stages, 3, "soft")).toEqual(stages[3]);
  });

  it("на развилке выбирает вариант, совпадающий с branch", () => {
    expect(findStageByOrder(stages, 2, "soft")).toEqual(stages[1]);
    expect(findStageByOrder(stages, 2, "hard")).toEqual(stages[2]);
  });

  it("undefined трактуется как null (нет решения — на развилке ничего не совпадёт)", () => {
    expect(findStageByOrder(stages, 2, undefined)).toBeUndefined();
  });

  it("несуществующий order — undefined", () => {
    expect(findStageByOrder(stages, 99, null)).toBeUndefined();
  });
});
