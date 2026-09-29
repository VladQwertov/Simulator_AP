import { describe, expect, it } from "vitest";
import { getBaseActionEffect, getStageProgressDelta } from "./rules";

describe("getStageProgressDelta", () => {
  it("хорошее QUESTION на DISCOVERY продвигает прогресс сильнее, чем PRESSURE", () => {
    const questionDelta = getStageProgressDelta("DISCOVERY", "QUESTION", 90);
    const pressureDelta = getStageProgressDelta("DISCOVERY", "PRESSURE", 90);

    expect(questionDelta).toBeGreaterThan(0);
    expect(questionDelta).toBeGreaterThan(pressureDelta);
  });

  it("хорошее действие по теме стадии увеличивает прогресс", () => {
    expect(getStageProgressDelta("CONTACT", "RAPPORT", 90)).toBeGreaterThan(0);
  });

  it("действие не по теме стадии (контрпродуктивное) ухудшает прогресс даже при хорошем качестве", () => {
    expect(getStageProgressDelta("DISCOVERY", "PRESSURE", 95)).toBeLessThan(0);
  });

  it("разное качество даёт разный прогресс (монотонность по quality)", () => {
    const low = getStageProgressDelta("DISCOVERY", "QUESTION", 10);
    const mid = getStageProgressDelta("DISCOVERY", "QUESTION", 50);
    const high = getStageProgressDelta("DISCOVERY", "QUESTION", 90);

    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });
});

describe("getBaseActionEffect", () => {
  it("хорошая RAPPORT поднимает trust, плохая — не поднимает (или опускает)", () => {
    const good = getBaseActionEffect("RAPPORT", 95);
    const bad = getBaseActionEffect("RAPPORT", 5);

    expect(good.opponent.trust).toBeGreaterThan(0);
    expect(bad.opponent.trust).toBeLessThan(good.opponent.trust);
  });

  it("грубое (некачественное) PRESSURE сильнее поднимает resistance и роняет trust, чем твёрдое, но качественное", () => {
    const clumsy = getBaseActionEffect("PRESSURE", 10);
    const firm = getBaseActionEffect("PRESSURE", 90);

    expect(clumsy.opponent.resistance).toBeGreaterThan(firm.opponent.resistance);
    expect(clumsy.opponent.trust).toBeLessThan(firm.opponent.trust);
  });

  it("каждый ActionType инкрементирует свой счётчик player-состояния", () => {
    expect(getBaseActionEffect("QUESTION", 50).player.questions).toBe(1);
    expect(getBaseActionEffect("ARGUMENT", 50).player.arguments).toBe(1);
    expect(getBaseActionEffect("CONCESSION", 50).player.concessions).toBe(1);
    expect(getBaseActionEffect("PRESSURE", 50).player.pressure).toBe(1);
    expect(getBaseActionEffect("RAPPORT", 50).player.rapport).toBe(1);
  });

  it("ABUSE всегда роняет trust и поднимает resistance — независимо от quality", () => {
    const shortAbuse = getBaseActionEffect("ABUSE", 10);
    const longAbuse = getBaseActionEffect("ABUSE", 95);

    expect(shortAbuse.opponent.trust).toBeLessThan(0);
    expect(shortAbuse.opponent.resistance).toBeGreaterThan(0);
    // "качественного" оскорбления не бывает — эффект не масштабируется по quality.
    expect(shortAbuse).toEqual(longAbuse);
  });

  it("ABUSE/GIBBERISH/OFF_TOPIC никогда не поднимают agreementProbability", () => {
    expect(getBaseActionEffect("ABUSE", 90).agreementProbability).toBe(0);
    expect(getBaseActionEffect("GIBBERISH", 90).agreementProbability).toBe(0);
    expect(getBaseActionEffect("OFF_TOPIC", 90).agreementProbability).toBe(0);
  });

  it("GIBBERISH/OFF_TOPIC не меняют состояние оппонента вообще", () => {
    const gibberish = getBaseActionEffect("GIBBERISH", 80);
    const offTopic = getBaseActionEffect("OFF_TOPIC", 80);

    expect(gibberish.opponent).toEqual({ trust: 0, resistance: 0, interest: 0, pressure: 0 });
    expect(offTopic.opponent).toEqual({ trust: 0, resistance: 0, interest: 0, pressure: 0 });
  });
});

describe("getStageProgressDelta — мусорные категории", () => {
  it("GIBBERISH/OFF_TOPIC всегда дают ровно 0 прогресса, на любой стадии и при любом quality", () => {
    for (const type of ["CONTACT", "DISCOVERY", "PITCH", "OBJECTION", "CLOSING"] as const) {
      expect(getStageProgressDelta(type, "GIBBERISH", 5)).toBe(0);
      expect(getStageProgressDelta(type, "GIBBERISH", 95)).toBe(0);
      expect(getStageProgressDelta(type, "OFF_TOPIC", 95)).toBe(0);
    }
  });

  it("ABUSE всегда отрицательный прогресс, даже при формально высоком quality (не может выглядеть как хорошее действие)", () => {
    expect(getStageProgressDelta("CLOSING", "ABUSE", 95)).toBeLessThan(0);
    expect(getStageProgressDelta("CLOSING", "ABUSE", 5)).toBeLessThan(0);
  });
});
