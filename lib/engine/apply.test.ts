import { describe, expect, it } from "vitest";
import { applyAction } from "./apply";
import { makeLevel, makeState } from "./test-fixtures";

describe("applyAction", () => {
  it("увеличивает round на 1", () => {
    const state = makeState();
    const level = makeLevel();
    const next = applyAction(state, level, level.stages[0], "QUESTION", 70);

    expect(next.round).toBe(state.round + 1);
  });

  it("хорошее действие по теме стадии увеличивает прогресс текущей Stage", () => {
    const state = makeState({ stageProgress: { order: 1, type: "CONTACT", progress: 0, attempts: 0 } });
    const level = makeLevel();

    const next = applyAction(state, level, level.stages[0], "RAPPORT", 90);

    expect(next.stageProgress.progress).toBeGreaterThan(0);
  });

  it("плохое действие ухудшает состояние оппонента (грубое давление роняет trust)", () => {
    const state = makeState();
    const level = makeLevel();

    const next = applyAction(state, level, level.stages[0], "PRESSURE", 5);

    expect(next.opponent.trust).toBeLessThan(state.opponent.trust);
    expect(next.opponent.resistance).toBeGreaterThan(state.opponent.resistance);
  });

  it("не мутирует исходный state (чистая функция)", () => {
    const state = makeState();
    const level = makeLevel();
    const snapshot = JSON.parse(JSON.stringify(state));

    applyAction(state, level, level.stages[0], "ARGUMENT", 80);

    expect(state).toEqual(snapshot);
  });

  it("клэмпит trust/interest/resistance/pressure в диапазоне 0-100", () => {
    const state = makeState({ opponent: { trust: 98, resistance: 2, interest: 98, pressure: 2, hiddenGoals: "x" } });
    const level = makeLevel();

    const next = applyAction(state, level, level.stages[0], "RAPPORT", 100);

    expect(next.opponent.trust).toBeLessThanOrEqual(100);
    expect(next.opponent.trust).toBeGreaterThanOrEqual(0);
  });

  it("RAPPORT/CONCESSION копят soft-сигнал развилки, PRESSURE/ARGUMENT — hard", () => {
    const level = makeLevel();
    let state = makeState();

    state = applyAction(state, level, level.stages[0], "RAPPORT", 80);
    state = applyAction(state, level, level.stages[0], "CONCESSION", 80);
    expect(state.branchSignal).toEqual({ soft: 2, hard: 0 });

    state = applyAction(state, level, level.stages[0], "PRESSURE", 20);
    state = applyAction(state, level, level.stages[0], "ARGUMENT", 60);
    expect(state.branchSignal).toEqual({ soft: 2, hard: 2 });
  });

  it("QUESTION/CLARIFICATION/NEUTRAL/ABUSE не двигают branchSignal", () => {
    const level = makeLevel();
    let state = makeState();

    state = applyAction(state, level, level.stages[0], "QUESTION", 70);
    state = applyAction(state, level, level.stages[0], "CLARIFICATION", 70);
    state = applyAction(state, level, level.stages[0], "NEUTRAL", 50);
    state = applyAction(state, level, level.stages[0], "ABUSE", 0);

    expect(state.branchSignal).toEqual({ soft: 0, hard: 0 });
  });
});
