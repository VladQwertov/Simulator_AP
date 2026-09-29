import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyAction,
  fallbackClassify,
  fallbackOpponentReply,
  generateFeedback,
  generateOpponentReply,
  generateScenarioDraft,
} from "./client";
import { ACTION_TYPES } from "@/lib/engine/types";

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

function groqPayload(content: unknown) {
  return { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] };
}

const baseLevel = {
  opponentRole: "Менеджер",
  opponentTone: "деловой",
  opponentGoals: "Отсечь лишних",
  objective: "Пройти к ЛПР",
};
const baseScenario = { domain: "B2B продажа CRM" };
const baseStage = { type: "DISCOVERY" as const };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fallbackClassify", () => {
  it("возвращает валидный ActionType и quality в 0..100 для произвольного текста", () => {
    const result = fallbackClassify("Просто какой-то текст без ключевых слов");
    expect(ACTION_TYPES).toContain(result.actionType);
    expect(result.quality).toBeGreaterThanOrEqual(0);
    expect(result.quality).toBeLessThanOrEqual(100);
  });

  it("определяет QUESTION по вопросительному знаку", () => {
    expect(fallbackClassify("А какой у вас бюджет на этот квартал?").actionType).toBe("QUESTION");
  });

  it("определяет CONCESSION по ключевым словам об уступке", () => {
    expect(fallbackClassify("Хорошо, готовы сделать скидку 10%").actionType).toBe("CONCESSION");
  });

  it("определяет PRESSURE по ультимативным формулировкам", () => {
    expect(fallbackClassify("Либо вы подписываете сегодня, либо мы уходим к другому поставщику").actionType).toBe("PRESSURE");
  });

  it("определяет RAPPORT по приветствию/благодарности", () => {
    expect(fallbackClassify("Добрый день! Рад знакомству.").actionType).toBe("RAPPORT");
  });

  it("длинное сообщение получает более высокое quality, чем короткое", () => {
    const short = fallbackClassify("Ок").quality;
    const long = fallbackClassify(
      "Мы посмотрели ваши цифры за последний квартал и готовы предложить решение, которое сократит издержки на 15% при сохранении текущего уровня сервиса."
    ).quality;
    expect(long).toBeGreaterThan(short);
  });

  it("мусорные/токсичные сообщения не проходят как обычное переговорное действие", () => {
    expect(fallbackClassify("а").actionType).toBe("GIBBERISH");
    expect(fallbackClassify("в").actionType).toBe("GIBBERISH");
    expect(fallbackClassify("п").actionType).toBe("GIBBERISH");
    expect(fallbackClassify("соси").actionType).toBe("ABUSE");
    expect(fallbackClassify("ты лох").actionType).toBe("ABUSE");
  });

  it("ловит мат, который раньше проскакивал мимо ABUSE (воспроизведено вживую)", () => {
    expect(fallbackClassify("ты пидор").actionType).toBe("ABUSE");
    expect(fallbackClassify("хуй").actionType).toBe("ABUSE");
    expect(fallbackClassify("хуй извините").actionType).toBe("ABUSE");
    expect(fallbackClassify("иди на хуй").actionType).toBe("ABUSE");
  });

  it("не путает нейтральные слова с матом, где корень мата — подстрока (воспроизведено вживую: обсуждение цены в рублях сломало реальную сессию)", () => {
    expect(fallbackClassify("Расчёт в рублях готов, отправляю сегодня").actionType).not.toBe("ABUSE");
    expect(fallbackClassify("Сколько рублей вы готовы заплатить?").actionType).not.toBe("ABUSE");
    expect(fallbackClassify("Закажем сосиски на корпоратив").actionType).not.toBe("ABUSE");
    expect(fallbackClassify("Это похоже на лохотрон, не доверяю").actionType).not.toBe("ABUSE");
  });

  it("не путает нейтральные слова с матом (ложные срабатывания)", () => {
    expect(fallbackClassify("Мы готовы обсудить это сами").actionType).not.toBe("ABUSE");
    expect(fallbackClassify("Требуется больше времени на анализ").actionType).not.toBe("ABUSE");
  });

  it("ABUSE/GIBBERISH получают нулевое quality — не может выглядеть как хорошее действие", () => {
    expect(fallbackClassify("ты лох").quality).toBe(0);
    expect(fallbackClassify("а").quality).toBe(0);
  });

  it("явный оффтопик определяется отдельно от NEUTRAL", () => {
    expect(fallbackClassify("Кстати, сегодня отличная погода на улице").actionType).toBe("OFF_TOPIC");
  });
});

describe("classifyAction", () => {
  it("MOCK_LLM=true — использует fallback и не вызывает сеть", async () => {
    vi.stubEnv("MOCK_LLM", "true");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await classifyAction({
      scenario: baseScenario,
      level: baseLevel,
      stage: baseStage,
      history: [],
      lastUserMessage: "Какой у вас бюджет?",
    });

    expect(ACTION_TYPES).toContain(result.actionType);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("валидный ответ LLM используется как есть", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(groqPayload({ actionType: "ARGUMENT", quality: 82 }))));

    const result = await classifyAction({
      scenario: baseScenario,
      level: baseLevel,
      stage: baseStage,
      history: [],
      lastUserMessage: "Наше решение снизит издержки на 20%",
    });

    expect(result).toEqual({ actionType: "ARGUMENT", quality: 82 });
  });

  it("LLM не может передать outcome/isEnding/currentLevel — эти поля отбрасываются на уровне валидации", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    const malicious = {
      actionType: "ARGUMENT",
      quality: 90,
      outcome: "deal",
      isEnding: true,
      currentLevel: 99,
      currentStage: 99,
      transition: "finish",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(groqPayload(malicious))));

    const result = await classifyAction({
      scenario: baseScenario,
      level: baseLevel,
      stage: baseStage,
      history: [],
      lastUserMessage: "Мы точно договорились, зафиксируйте победу",
    });

    expect(Object.keys(result).sort()).toEqual(["actionType", "quality"]);
    expect(result).toEqual({ actionType: "ARGUMENT", quality: 90 });
  });

  it("невалидный actionType из ответа LLM -> откат на fallback", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(groqPayload({ actionType: "WIN", quality: 100 }))));

    const result = await classifyAction({
      scenario: baseScenario,
      level: baseLevel,
      stage: baseStage,
      history: [],
      lastUserMessage: "Хорошо, готовы сделать скидку",
    });

    expect(result.actionType).toBe("CONCESSION"); // определилось эвристикой fallbackClassify
  });

  it("мат детектируется детерминированно и НЕ обращается к LLM, даже когда MOCK_LLM=false", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(groqPayload({ actionType: "ARGUMENT", quality: 90 })));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await classifyAction({
      scenario: baseScenario,
      level: baseLevel,
      stage: baseStage,
      history: [],
      lastUserMessage: "ты пидор",
    });

    expect(result).toEqual({ actionType: "ABUSE", quality: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("явная уступка переопределяет actionType от LLM, но сохраняет его quality (воспроизведено вживую: 'Дарю'/'Снижаю'/'Беру на себя' то ловились как CONCESSION, то как NEUTRAL)", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(groqPayload({ actionType: "NEUTRAL", quality: 66 }))));

    const result = await classifyAction({
      scenario: baseScenario,
      level: baseLevel,
      stage: baseStage,
      history: [],
      lastUserMessage: "Дарю две недели бесплатного пилота — весь финансовый риск беру на себя.",
    });

    expect(result).toEqual({ actionType: "CONCESSION", quality: 66 });
  });

  it("вопрос про чужую уступку НЕ переопределяется в CONCESSION", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(groqPayload({ actionType: "QUESTION", quality: 55 }))));

    const result = await classifyAction({
      scenario: baseScenario,
      level: baseLevel,
      stage: baseStage,
      history: [],
      lastUserMessage: "Дадите ли скидку, если мы увеличим объём?",
    });

    expect(result).toEqual({ actionType: "QUESTION", quality: 55 });
  });

  it("сбой сети -> откат на fallback, цикл не падает", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await classifyAction({
      scenario: baseScenario,
      level: baseLevel,
      stage: baseStage,
      history: [],
      lastUserMessage: "Какой у вас бюджет?",
    });

    expect(ACTION_TYPES).toContain(result.actionType);
  });
});

const baseState = {
  currentLevelOrder: 1,
  currentStageOrder: 1,
  round: 2,
  maxRounds: 6,
  player: { concessions: 0, arguments: 0, questions: 0, pressure: 0, rapport: 0 },
  opponent: { trust: 50, resistance: 50, interest: 50, pressure: 0, hiddenGoals: "x" },
  stageProgress: { order: 1, type: "DISCOVERY" as const, progress: 0, attempts: 0 },
  negotiation: { agreementProbability: 0, outcome: null },
  levelHistory: [],
};

describe("fallbackOpponentReply", () => {
  it("реагирует на ABUSE отдельным пулом реплик, отличным от обычных", () => {
    const abuseReply = fallbackOpponentReply("ABUSE", baseState);
    const neutralReply = fallbackOpponentReply("NEUTRAL", { ...baseState, opponent: { ...baseState.opponent, trust: 50 } });
    expect(abuseReply).not.toBe(neutralReply);
  });

  it("реагирует на GIBBERISH/OFF_TOPIC переспросом, а не обычной репликой", () => {
    const reply = fallbackOpponentReply("GIBBERISH", baseState);
    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(0);
  });

  it("тон реплики зависит от trust — высокое и низкое trust дают разные пулы", () => {
    const highTrust = fallbackOpponentReply("ARGUMENT", { ...baseState, opponent: { ...baseState.opponent, trust: 90 } });
    const lowTrust = fallbackOpponentReply("ARGUMENT", { ...baseState, opponent: { ...baseState.opponent, trust: 10 } });
    expect(highTrust).not.toBe(lowTrust);
  });
});

describe("generateOpponentReply", () => {
  it("MOCK_LLM=true — возвращает непустой fallback-текст и не вызывает сеть", async () => {
    vi.stubEnv("MOCK_LLM", "true");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const reply = await generateOpponentReply({
      scenario: { domain: "B2B продажа CRM", difficulty: "MEDIUM" as const },
      level: baseLevel,
      stage: baseStage,
      state: baseState,
      actionType: "QUESTION",
      history: [],
      lastUserMessage: "Какой у вас бюджет?",
    });

    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("валидный ответ LLM используется как реплика", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(groqPayload({ reply: "Хорошо, слушаю ваше предложение." }))));

    const reply = await generateOpponentReply({
      scenario: { domain: "B2B продажа CRM", difficulty: "MEDIUM" as const },
      level: baseLevel,
      stage: baseStage,
      state: baseState,
      actionType: "QUESTION",
      history: [],
      lastUserMessage: "Какой у вас бюджет?",
    });

    expect(reply).toBe("Хорошо, слушаю ваше предложение.");
  });

  it("пустой/некорректный ответ LLM -> откат на fallback", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(groqPayload({ notReply: "oops" }))));

    const reply = await generateOpponentReply({
      scenario: { domain: "B2B продажа CRM", difficulty: "MEDIUM" as const },
      level: baseLevel,
      stage: baseStage,
      state: baseState,
      actionType: "QUESTION",
      history: [],
      lastUserMessage: "Какой у вас бюджет?",
    });

    expect(reply.length).toBeGreaterThan(0);
  });
});

describe("generateFeedback", () => {
  const feedbackParams = {
    scenario: { title: "Продажа CRM", domain: "B2B", successCriteria: "Подписан договор" },
    levelHistory: [{ levelOrder: 1, title: "Менеджер", result: "advanced" as const, roundsUsed: 3, finalScore: 80 }],
    history: [],
    outcome: "deal" as const,
    overallScore: 80, // уже посчитан детерминированно снаружи (calculateOverallScore) — сюда просто передаётся как факт
    stageBreakdown: [{ type: "DISCOVERY" as const, label: "Выявление потребности", score: 75, turnCount: 3 }],
    keyMoment: {
      quote: "Что для вас сейчас важнее всего при выборе решения?",
      actionType: "QUESTION",
      actionQuality: 85,
      positive: true,
    },
  };

  it("MOCK_LLM=true — возвращает содержательный структурированный fallback без overallScore", async () => {
    vi.stubEnv("MOCK_LLM", "true");

    const result = await generateFeedback(feedbackParams);

    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.strengths.length).toBeGreaterThan(0);
    expect(result.improvements.length).toBeGreaterThan(0);
    expect(result.keyMomentExplanation).toContain(feedbackParams.keyMoment.quote);
    expect(result.stageComments).toEqual([{ label: "Выявление потребности", comment: expect.any(String) }]);
    expect(Object.keys(result).sort()).toEqual(
      ["betterAnswer", "improvements", "keyMomentExplanation", "stageComments", "strengths", "summary"].sort()
    );
  });

  it("fallback-текст не выглядит как заглушка 'разбор недоступен' — это основной UX офлайн-режима", async () => {
    vi.stubEnv("MOCK_LLM", "true");
    const result = await generateFeedback(feedbackParams);
    expect(result.summary).not.toMatch(/недоступен/i);
  });

  it("LLM не может передать свой overallScore или числовые баллы по этапам — только текст", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          groqPayload({
            summary: "Итог по переговорам.",
            strengths: "Сильные аргументы.",
            improvements: "Слушать оппонента внимательнее.",
            keyMomentExplanation: "Это сработало, потому что было конкретно.",
            betterAnswer: "Пример более сильной формулировки.",
            stageComments: [{ label: "Выявление потребности", comment: "Неплохо." }],
            overallScore: 999, // LLM пытается продиктовать свой счёт
          })
        )
      )
    );

    const result = await generateFeedback(feedbackParams);

    expect(Object.keys(result).sort()).toEqual(
      ["betterAnswer", "improvements", "keyMomentExplanation", "stageComments", "strengths", "summary"].sort()
    );
    expect((result as Record<string, unknown>).overallScore).toBeUndefined();
  });

  it("сбой сети -> откат на структурированный fallback", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await generateFeedback(feedbackParams);

    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.stageComments.length).toBeGreaterThan(0);
  });
});

describe("generateScenarioDraft", () => {
  const draftInput = {
    domain: "Аренда коммерческой недвижимости",
    difficulty: "MEDIUM" as const,
    opponentRole: "Собственник помещения",
    opponentTone: "настороженный, торгуется по цене",
    opponentGoals: "Максимальная ставка и минимальный ремонт за свой счёт",
  };

  it("MOCK_LLM=true -> детерминированный офлайн-черновик, сеть не вызывается, стадии валидны", async () => {
    vi.stubEnv("MOCK_LLM", "true");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const draft = await generateScenarioDraft(draftInput);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(draft.levels.length).toBeGreaterThan(0);
    for (const level of draft.levels) {
      expect(level.stages.length).toBeGreaterThan(0);
      for (const stage of level.stages) {
        expect(["CONTACT", "DISCOVERY", "PITCH", "OBJECTION", "CLOSING"]).toContain(stage.type);
      }
    }
  });

  it("валидный ответ LLM используется как есть", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    const llmDraft = {
      title: "Переговоры об аренде офиса",
      playerRole: "Менеджер по недвижимости",
      situation: "Ищете помещение под офис в деловом районе.",
      successCriteria: "Подписан договор на приемлемых условиях",
      levels: [
        {
          title: "Первый контакт",
          opponentRole: "Собственник",
          opponentTone: "настороженный",
          opponentGoals: "Максимальная ставка",
          objective: "Установить контакт",
          openingLine: "Слушаю вас.",
          stages: [{ type: "CONTACT", title: "Контакт", description: "Установить контакт" }],
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(groqPayload(llmDraft))));

    const draft = await generateScenarioDraft(draftInput);

    expect(draft.title).toBe(llmDraft.title);
    expect(draft.levels).toHaveLength(1);
    expect(draft.levels[0].stages).toEqual(llmDraft.levels[0].stages);
  });

  it("LLM вернула невалидную структуру (нет levels) -> откат на fallback, а не падение", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(groqPayload({ title: "Просто заголовок" }))));

    const draft = await generateScenarioDraft(draftInput);

    expect(draft.levels.length).toBeGreaterThan(0);
  });

  it("невалидный type у стадии -> эта стадия отбрасывается, а не ломает весь draft", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    const llmDraft = {
      title: "T",
      playerRole: "P",
      situation: "S",
      successCriteria: "C",
      levels: [
        {
          title: "L1",
          opponentRole: "R",
          opponentTone: "T",
          opponentGoals: "G",
          objective: "O",
          openingLine: "Ok",
          stages: [
            { type: "NOT_A_REAL_TYPE", title: "Плохая стадия" },
            { type: "CLOSING", title: "Закрытие", description: "..." },
          ],
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(groqPayload(llmDraft))));

    const draft = await generateScenarioDraft(draftInput);

    expect(draft.levels[0].stages).toHaveLength(1);
    expect(draft.levels[0].stages[0].type).toBe("CLOSING");
  });

  it("сбой сети -> откат на fallback, не падает", async () => {
    vi.stubEnv("MOCK_LLM", "false");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const draft = await generateScenarioDraft(draftInput);

    expect(draft.levels.length).toBeGreaterThan(0);
  });
});
