import { describe, expect, it } from "vitest";
import { evaluateTransition } from "./transition";
import { makeLevel, makeState, makeStage } from "./test-fixtures";

const twoStageLevel = makeLevel({
  order: 1,
  title: "Level 1",
  opponentGoals: "Level 1 goals",
  maxRounds: 6,
  advanceThreshold: 70,
  failThreshold: 20,
  stages: [makeStage({ order: 1, type: "CONTACT" }), makeStage({ order: 2, type: "DISCOVERY" })],
});

const levelTwo = makeLevel({
  order: 2,
  title: "Level 2",
  opponentGoals: "Level 2 goals",
  maxRounds: 8,
  advanceThreshold: 70,
  failThreshold: 20,
  stages: [makeStage({ order: 1, type: "PITCH" })],
});

// Развилка сразу после единственной вступительной стадии: order=2 делят два варианта OBJECTION.
const forkedLevel = makeLevel({
  order: 1,
  title: "Forked Level",
  opponentGoals: "Forked Level goals",
  maxRounds: 6,
  advanceThreshold: 70,
  failThreshold: 20,
  stages: [
    makeStage({ order: 1, type: "CONTACT" }),
    makeStage({ order: 2, type: "OBJECTION", branchKey: "soft" }),
    makeStage({ order: 2, type: "OBJECTION", branchKey: "hard" }),
  ],
});

describe("evaluateTransition — ветвление сценария", () => {
  it("выбирает soft-вариант при преобладании мягких действий (branchSignal)", () => {
    const state = makeState({
      currentStageOrder: 1,
      stageProgress: { order: 1, type: "CONTACT", progress: 100, attempts: 2 },
      round: 2,
      branchSignal: { soft: 3, hard: 1 },
    });

    const { transition, state: next } = evaluateTransition(state, forkedLevel, null);

    expect(transition).toBe("advance-stage");
    expect(next.branch).toBe("soft");
    expect(next.currentStageOrder).toBe(2);
    expect(next.stageProgress).toEqual({ order: 2, type: "OBJECTION", progress: 0, attempts: 0 });
  });

  it("выбирает hard-вариант при преобладании жёстких действий (branchSignal)", () => {
    const state = makeState({
      currentStageOrder: 1,
      stageProgress: { order: 1, type: "CONTACT", progress: 100, attempts: 2 },
      round: 2,
      branchSignal: { soft: 1, hard: 3 },
    });

    const { state: next } = evaluateTransition(state, forkedLevel, null);

    expect(next.branch).toBe("hard");
  });

  it("при равном счёте (или его отсутствии) по умолчанию выбирает soft", () => {
    const state = makeState({
      currentStageOrder: 1,
      stageProgress: { order: 1, type: "CONTACT", progress: 100, attempts: 1 },
      round: 1,
      branchSignal: { soft: 0, hard: 0 },
    });

    const { state: next } = evaluateTransition(state, forkedLevel, null);

    expect(next.branch).toBe("soft");
  });

  it("однажды выбранная ветка не пересматривается на следующих ходах внутри неё", () => {
    // Уже в hard-ветке (order=2, branchKey=hard); branchSignal с тех пор сместился в сторону soft,
    // но branch зафиксирован при входе в стадию и не должен смениться.
    const state = makeState({
      currentLevelOrder: 1,
      currentStageOrder: 2,
      stageProgress: { order: 2, type: "OBJECTION", progress: 100, attempts: 2 },
      round: 4,
      branch: "hard",
      branchSignal: { soft: 5, hard: 1 },
      negotiation: { agreementProbability: 90, outcome: null },
    });

    const { transition, state: next } = evaluateTransition(state, forkedLevel, null);

    expect(transition).toBe("finish");
    expect(next.negotiation.outcome).toBe("deal");
  });

  it("levelHistory фиксирует, какая ветка была выбрана на уровне", () => {
    const state = makeState({
      currentLevelOrder: 1,
      currentStageOrder: 2,
      stageProgress: { order: 2, type: "OBJECTION", progress: 100, attempts: 2 },
      round: 4,
      branch: "soft",
      negotiation: { agreementProbability: 80, outcome: null },
    });

    const { state: next } = evaluateTransition(state, forkedLevel, null);

    expect(next.levelHistory[0].branch).toBe("soft");
  });

  it("состояние без branch/branchSignal (сессии до появления ветвления) не падает — трактуется как soft/{0,0}", () => {
    const legacyState = makeState({
      currentStageOrder: 1,
      stageProgress: { order: 1, type: "CONTACT", progress: 100, attempts: 1 },
      round: 1,
    });
    // branch/branchSignal — опциональные поля именно ради этого случая: эмулируем старый
    // NegotiationState, сохранённый в БД до появления ветвления.
    delete legacyState.branch;
    delete legacyState.branchSignal;

    const { state: next } = evaluateTransition(legacyState, forkedLevel, null);

    expect(next.branch).toBe("soft");
  });
});

describe("evaluateTransition", () => {
  it("Stage может завершиться и перейти на следующую Stage внутри Level (advance-stage)", () => {
    const state = makeState({
      currentStageOrder: 1,
      stageProgress: { order: 1, type: "CONTACT", progress: 100, attempts: 2 },
      round: 2,
    });

    const { transition, state: next } = evaluateTransition(state, twoStageLevel, null);

    expect(transition).toBe("advance-stage");
    expect(next.currentStageOrder).toBe(2);
    expect(next.stageProgress).toEqual({ order: 2, type: "DISCOVERY", progress: 0, attempts: 0 });
  });

  it("Stage может остаться текущей, если прогресс недостаточен, а попытки ещё допустимы (continue)", () => {
    const state = makeState({
      currentStageOrder: 1,
      stageProgress: { order: 1, type: "CONTACT", progress: 30, attempts: 1 },
      round: 1,
    });

    const { transition, state: next } = evaluateTransition(state, twoStageLevel, null);

    expect(transition).toBe("continue");
    expect(next.currentStageOrder).toBe(1);
  });

  it("успешное завершение последней Stage переводит на следующий Level (advance-level)", () => {
    const state = makeState({
      currentLevelOrder: 1,
      currentStageOrder: 2,
      stageProgress: { order: 2, type: "DISCOVERY", progress: 100, attempts: 3 },
      round: 3,
      negotiation: { agreementProbability: 80, outcome: null },
    });

    const { transition, state: next } = evaluateTransition(state, twoStageLevel, levelTwo);

    expect(transition).toBe("advance-level");
    expect(next.currentLevelOrder).toBe(2);
    expect(next.currentStageOrder).toBe(1);
    expect(next.round).toBe(0);
    expect(next.maxRounds).toBe(8);
  });

  it("при переходе на следующий Level состояние NPC пересоздаётся заново", () => {
    const state = makeState({
      currentLevelOrder: 1,
      currentStageOrder: 2,
      stageProgress: { order: 2, type: "DISCOVERY", progress: 100, attempts: 3 },
      round: 3,
      opponent: { trust: 90, resistance: 10, interest: 95, pressure: 40, hiddenGoals: "Level 1 goals" },
      negotiation: { agreementProbability: 80, outcome: null },
    });

    const { state: next } = evaluateTransition(state, twoStageLevel, levelTwo);

    expect(next.opponent).toEqual({ trust: 50, resistance: 50, interest: 50, pressure: 0, hiddenGoals: "Level 2 goals" });
  });

  it("при переходе на следующий Level прогресс игрока сохраняется", () => {
    const state = makeState({
      currentLevelOrder: 1,
      currentStageOrder: 2,
      stageProgress: { order: 2, type: "DISCOVERY", progress: 100, attempts: 3 },
      round: 3,
      player: { concessions: 1, arguments: 5, questions: 4, pressure: 0, rapport: 2 },
      negotiation: { agreementProbability: 80, outcome: null },
    });

    const { state: next } = evaluateTransition(state, twoStageLevel, levelTwo);

    expect(next.player).toEqual(state.player);
  });

  it("превышение maxRounds без успешного перехода приводит к fail-level", () => {
    const state = makeState({
      currentStageOrder: 1,
      stageProgress: { order: 1, type: "CONTACT", progress: 40, attempts: 6 },
      round: 6,
      maxRounds: 6,
    });

    const { transition, state: next } = evaluateTransition(state, twoStageLevel, null);

    expect(transition).toBe("fail-level");
    expect(next.negotiation.outcome).toBe("failed");
    expect(next.levelHistory).toEqual([
      { levelOrder: 1, title: "Level 1", result: "failed", roundsUsed: 6, finalScore: 0, branch: null },
    ]);
  });

  it("критически низкий trust приводит к fail-level независимо от раунда", () => {
    const state = makeState({
      round: 1,
      opponent: { trust: 15, resistance: 50, interest: 50, pressure: 0, hiddenGoals: "Level 1 goals" },
    });

    const { transition } = evaluateTransition(state, twoStageLevel, null);

    expect(transition).toBe("fail-level");
  });

  it("критически низкий interest приводит к fail-level независимо от раунда", () => {
    const state = makeState({
      round: 1,
      opponent: { trust: 50, resistance: 50, interest: 10, pressure: 0, hiddenGoals: "Level 1 goals" },
    });

    const { transition } = evaluateTransition(state, twoStageLevel, null);

    expect(transition).toBe("fail-level");
  });

  it("успешное завершение последней Stage последнего Level завершает сценарий (finish)", () => {
    const state = makeState({
      currentLevelOrder: 2,
      currentStageOrder: 1,
      stageProgress: { order: 1, type: "PITCH", progress: 100, attempts: 2 },
      round: 2,
      negotiation: { agreementProbability: 90, outcome: null },
    });

    const { transition, state: next } = evaluateTransition(state, levelTwo, null);

    expect(transition).toBe("finish");
    expect(next.negotiation.outcome).toBe("deal");
  });

  it("finish с agreementProbability между advanceThreshold и порогом deal даёт исход partial", () => {
    const state = makeState({
      currentLevelOrder: 2,
      currentStageOrder: 1,
      stageProgress: { order: 1, type: "PITCH", progress: 100, attempts: 2 },
      round: 2,
      negotiation: { agreementProbability: 72, outcome: null },
    });

    const { transition, state: next } = evaluateTransition(state, levelTwo, null);

    expect(transition).toBe("finish");
    expect(next.negotiation.outcome).toBe("partial");
  });
});
