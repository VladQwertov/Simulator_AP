import { describe, expect, it } from "vitest";
import { processTurn } from "./index";
import { createInitialState } from "./state";
import { makeLevel, makeStage } from "./test-fixtures";

describe("processTurn (интеграция apply + transition)", () => {
  const level = makeLevel({
    order: 1,
    title: "Менеджер",
    opponentGoals: "Отсечь лишних",
    maxRounds: 10,
    advanceThreshold: 60,
    failThreshold: 20,
    stages: [makeStage({ order: 1, type: "CONTACT" })],
  });

  it("RAPPORT доводит Stage до конца, а затем ARGUMENT поднимает agreementProbability до finish", () => {
    // RAPPORT — правильное действие для CONTACT (двигает прогресс Stage), но не влияет на
    // agreementProbability; ARGUMENT поднимает agreementProbability, когда Stage уже пройдена.
    // Это осознанно: одного раппорта недостаточно, чтобы закрыть сделку.
    let state = createInitialState(level);
    let result;

    for (let i = 0; i < level.maxRounds; i++) {
      const actionType = state.stageProgress.progress < 100 ? "RAPPORT" : "ARGUMENT";
      result = processTurn({ state, level, nextLevel: null, actionType, quality: 95 });
      state = result.state;
      if (result.isEnding) break;
    }

    expect(result!.isEnding).toBe(true);
    expect(result!.transition).toBe("finish");
    expect(state.negotiation.outcome).not.toBeNull();
  });

  it("серия плохих PRESSURE-ходов роняет trust/interest до критического fail-level", () => {
    let state = createInitialState(level);
    let result;

    for (let i = 0; i < 10; i++) {
      result = processTurn({ state, level, nextLevel: null, actionType: "PRESSURE", quality: 5 });
      state = result.state;
      if (result.isEnding) break;
    }

    expect(result!.transition).toBe("fail-level");
    expect(result!.isEnding).toBe(true);
    expect(state.negotiation.outcome).toBe("failed");
  });

  it("повторный ABUSE обрывает переговоры за пару ходов, а не тянется до maxRounds", () => {
    // Живой прогон показал баг не здесь, а в классификации (LLM то ловила мат, то нет) —
    // но если ABUSE распознан корректно каждый раз, Engine должен сам оборвать разговор рано:
    // trust начинается с 50, ABUSE даёт -15 за ход, failThreshold=20 -> хватает 2 ходов (50->35->20).
    let state = createInitialState(level);
    let result;

    for (let i = 0; i < level.maxRounds; i++) {
      result = processTurn({ state, level, nextLevel: null, actionType: "ABUSE", quality: 0 });
      state = result.state;
      if (result.isEnding) break;
    }

    expect(result!.transition).toBe("fail-level");
    expect(result!.isEnding).toBe(true);
    expect(state.negotiation.outcome).toBe("failed");
    expect(state.round).toBeLessThan(level.maxRounds);
  });

  it("continue и advance-stage не считаются завершением сессии", () => {
    const state = createInitialState(level);
    const result = processTurn({ state, level, nextLevel: null, actionType: "NEUTRAL", quality: 50 });

    expect(result.isEnding).toBe(false);
  });
});
