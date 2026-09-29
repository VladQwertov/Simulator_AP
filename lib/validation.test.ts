import { describe, expect, it } from "vitest";
import { validateLevelInput, validatePublishReady, validateScenarioInput, validateStageInput } from "./validation";

describe("validateScenarioInput", () => {
  it("пустой title -> ошибка", () => {
    expect(validateScenarioInput({ title: "" })).toContain("title не может быть пустым");
    expect(validateScenarioInput({ title: "   " })).toContain("title не может быть пустым");
  });

  it("непустой title -> без ошибок, даже без playerRole/situation (черновик)", () => {
    expect(validateScenarioInput({ title: "Продажа CRM" })).toEqual([]);
  });
});

describe("validatePublishReady", () => {
  it("нельзя опубликовать без playerRole/situation/successCriteria", () => {
    const errors = validatePublishReady({});
    expect(errors.length).toBe(3);
  });

  it("все поля заполнены -> без ошибок", () => {
    expect(
      validatePublishReady({ playerRole: "Менеджер", situation: "Первая встреча", successCriteria: "Договорились" })
    ).toEqual([]);
  });
});

const validLevel = {
  title: "Менеджер",
  objective: "Получить контакт ЛПР",
  openingLine: "Слушаю вас.",
  maxRounds: 6,
  advanceThreshold: 70,
  failThreshold: 20,
};

describe("validateLevelInput", () => {
  it("валидный Level -> без ошибок", () => {
    expect(validateLevelInput(validLevel)).toEqual([]);
  });

  it("пустой title -> ошибка", () => {
    expect(validateLevelInput({ ...validLevel, title: "" })).toContain("title не может быть пустым");
  });

  it("пустой objective -> ошибка", () => {
    expect(validateLevelInput({ ...validLevel, objective: "" })).toContain("objective не может быть пустым");
  });

  it("пустой openingLine -> ошибка", () => {
    expect(validateLevelInput({ ...validLevel, openingLine: "" })).toContain("openingLine не может быть пустым");
  });

  it("maxRounds <= 0 -> ошибка", () => {
    expect(validateLevelInput({ ...validLevel, maxRounds: 0 })).toContain("maxRounds должен быть целым числом больше 0");
    expect(validateLevelInput({ ...validLevel, maxRounds: -1 })).toContain("maxRounds должен быть целым числом больше 0");
  });

  it("maxRounds/advanceThreshold/failThreshold дробные -> ошибка (не тихо округляются)", () => {
    expect(validateLevelInput({ ...validLevel, maxRounds: 3.7 })).toContain("maxRounds должен быть целым числом больше 0");
    expect(validateLevelInput({ ...validLevel, advanceThreshold: 30.5 })).toContain(
      "advanceThreshold должен быть целым числом в диапазоне 0..100"
    );
    expect(validateLevelInput({ ...validLevel, failThreshold: 10.2 })).toContain(
      "failThreshold должен быть целым числом в диапазоне 0..100"
    );
  });

  it("advanceThreshold вне 0..100 -> ошибка", () => {
    expect(validateLevelInput({ ...validLevel, advanceThreshold: -1 })).toContain(
      "advanceThreshold должен быть целым числом в диапазоне 0..100"
    );
    expect(validateLevelInput({ ...validLevel, advanceThreshold: 101 })).toContain(
      "advanceThreshold должен быть целым числом в диапазоне 0..100"
    );
  });

  it("failThreshold вне 0..100 -> ошибка", () => {
    expect(validateLevelInput({ ...validLevel, failThreshold: -1 })).toContain(
      "failThreshold должен быть целым числом в диапазоне 0..100"
    );
    expect(validateLevelInput({ ...validLevel, failThreshold: 101 })).toContain(
      "failThreshold должен быть целым числом в диапазоне 0..100"
    );
  });

  it("failThreshold >= advanceThreshold -> ошибка", () => {
    expect(validateLevelInput({ ...validLevel, advanceThreshold: 50, failThreshold: 50 })).toContain(
      "failThreshold должен быть меньше advanceThreshold"
    );
    expect(validateLevelInput({ ...validLevel, advanceThreshold: 50, failThreshold: 60 })).toContain(
      "failThreshold должен быть меньше advanceThreshold"
    );
  });
});

describe("validateStageInput", () => {
  it("валидный type -> без ошибок", () => {
    for (const type of ["CONTACT", "DISCOVERY", "PITCH", "OBJECTION", "CLOSING"]) {
      expect(validateStageInput({ type })).toEqual([]);
    }
  });

  it("пустой или невалидный type -> ошибка", () => {
    expect(validateStageInput({ type: "" }).length).toBeGreaterThan(0);
    expect(validateStageInput({ type: "WIN" }).length).toBeGreaterThan(0);
  });
});
