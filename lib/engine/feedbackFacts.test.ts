import { describe, expect, it } from "vitest";
import { buildStageBreakdown, pickKeyMoment, STAGE_TYPE_LABEL, type FeedbackTurnFact } from "./feedbackFacts";

function turn(overrides: Partial<FeedbackTurnFact> = {}): FeedbackTurnFact {
  return { role: "USER", text: "текст", actionType: "ARGUMENT", actionQuality: 70, stageType: "PITCH", ...overrides };
}

describe("buildStageBreakdown", () => {
  it("группирует по типу стадии и считает среднее actionQuality только по ходам игрока", () => {
    const turns: FeedbackTurnFact[] = [
      turn({ stageType: "CONTACT", actionQuality: 60 }),
      turn({ stageType: "CONTACT", actionQuality: 80 }),
      turn({ role: "OPPONENT", stageType: "CONTACT", actionQuality: null, actionType: null }),
      turn({ stageType: "PITCH", actionQuality: 40 }),
    ];

    const result = buildStageBreakdown(turns);

    expect(result).toEqual([
      { type: "CONTACT", label: STAGE_TYPE_LABEL.CONTACT, score: 70, turnCount: 2 },
      { type: "PITCH", label: STAGE_TYPE_LABEL.PITCH, score: 40, turnCount: 1 },
    ]);
  });

  it("сохраняет порядок CONTACT->DISCOVERY->PITCH->OBJECTION->CLOSING независимо от порядка входных ходов", () => {
    const turns: FeedbackTurnFact[] = [
      turn({ stageType: "CLOSING" }),
      turn({ stageType: "CONTACT" }),
      turn({ stageType: "OBJECTION" }),
    ];

    expect(buildStageBreakdown(turns).map((s) => s.type)).toEqual(["CONTACT", "OBJECTION", "CLOSING"]);
  });

  it("GIBBERISH/OFF_TOPIC не участвуют в среднем — они не про качество", () => {
    const turns: FeedbackTurnFact[] = [
      turn({ stageType: "CONTACT", actionType: "RAPPORT", actionQuality: 80 }),
      turn({ stageType: "CONTACT", actionType: "GIBBERISH", actionQuality: 0 }),
    ];

    expect(buildStageBreakdown(turns)).toEqual([{ type: "CONTACT", label: STAGE_TYPE_LABEL.CONTACT, score: 80, turnCount: 1 }]);
  });

  it("пустой ввод -> пустой результат", () => {
    expect(buildStageBreakdown([])).toEqual([]);
  });
});

describe("pickKeyMoment", () => {
  it("при успехе выбирает ход с максимальным quality", () => {
    const turns: FeedbackTurnFact[] = [
      turn({ text: "слабая реплика", actionQuality: 30 }),
      turn({ text: "сильная реплика", actionQuality: 90 }),
    ];

    const result = pickKeyMoment(turns, "deal");
    expect(result?.quote).toBe("сильная реплика");
    expect(result?.positive).toBe(true);
  });

  it("при провале приоритет — ABUSE-реплика, даже если её quality не самый низкий формально", () => {
    const turns: FeedbackTurnFact[] = [
      turn({ text: "просто слабая", actionQuality: 20, actionType: "NEUTRAL" }),
      turn({ text: "оскорбление", actionQuality: 0, actionType: "ABUSE" }),
    ];

    const result = pickKeyMoment(turns, "failed");
    expect(result?.quote).toBe("оскорбление");
    expect(result?.positive).toBe(false);
  });

  it("при провале без ABUSE выбирает ход с минимальным quality", () => {
    const turns: FeedbackTurnFact[] = [
      turn({ text: "нормально", actionQuality: 60 }),
      turn({ text: "слабо", actionQuality: 20 }),
    ];

    const result = pickKeyMoment(turns, "failed");
    expect(result?.quote).toBe("слабо");
  });

  it("нет ходов игрока -> null", () => {
    expect(pickKeyMoment([turn({ role: "OPPONENT" })], "deal")).toBeNull();
    expect(pickKeyMoment([], "deal")).toBeNull();
  });

  it("GIBBERISH/OFF_TOPIC никогда не становятся ключевым моментом", () => {
    const turns: FeedbackTurnFact[] = [turn({ actionType: "GIBBERISH", actionQuality: 0 })];
    expect(pickKeyMoment(turns, "deal")).toBeNull();
  });
});
