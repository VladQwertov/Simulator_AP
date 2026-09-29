// lib/llm/prompts.ts
// Промпты для двух строго разделённых ролей LLM:
// 1) classifyAction — классификация реплики игрока (actionType + quality), решения не принимает;
// 2) generateOpponentReply — только естественный текст реплики NPC;
// 3) generateFeedback — только текстовый разбор уже посчитанного (движком) исхода.
import type { Level, Scenario, Stage } from "@prisma/client";
import {
  ACTION_TYPES,
  deriveOpponentMood,
  type ActionType,
  type KeyMomentFact,
  type LevelHistoryEntry,
  type NegotiationState,
  type StageBreakdownFact,
} from "@/lib/engine";

const MOOD_TEXT = {
  positive: "ты настроен доверительно и доброжелательно",
  negative: "ты насторожен и держишь дистанцию",
  neutral: "ты держишься нейтрально-делово",
} as const;

export type HistoryTurn = {
  role: "USER" | "OPPONENT";
  text: string;
  actionType?: string | null;
  actionQuality?: number | null;
};

export type ClassifyResult = {
  actionType: ActionType;
  quality: number;
};

// overallScore и stageBreakdown[].score сюда намеренно не входят: они считаются детерминированно
// (lib/engine/score.ts, lib/engine/feedbackFacts.ts) и никогда не читаются из ответа LLM.
// LLM пишет только прозу поверх уже решённых фактов.
export type FeedbackResult = {
  summary: string;
  strengths: string;
  improvements: string;
  keyMomentExplanation: string;
  betterAnswer: string;
  stageComments: { label: string; comment: string }[];
};

const DIFFICULTY_NOTE: Record<Scenario["difficulty"], string> = {
  EASY: "Ты довольно легко идёшь на уступки, если аргумент хоть немного обоснован.",
  MEDIUM: "Ты уступаешь только в ответ на весомые аргументы, торгуешься за условия.",
  HARD: "Ты держишь позицию жёстко, уступаешь редко и только при очень сильной аргументации, можешь давить и проверять оппонента на прочность.",
};

const STAGE_NOTE: Record<Stage["type"], string> = {
  CONTACT: "устанавливаете контакт — оценивается уместность тона и рэппорта, а не аргументы по существу.",
  DISCOVERY: "выявляете ситуацию и потребность собеседника — ценнее всего уточняющие вопросы.",
  PITCH: "презентуете решение — ценнее всего конкретные, обоснованные аргументы.",
  OBJECTION: "отрабатываете возражение — ценны аргументы и уместные уступки.",
  CLOSING: "закрываете сделку — ценны конкретные уступки и финальные аргументы, давление на этом этапе рискованно.",
};

export function buildOpponentSystemPrompt(
  scenario: Pick<Scenario, "domain" | "difficulty">,
  level: Pick<Level, "opponentRole" | "opponentTone" | "opponentGoals">
): string {
  return `Ты играешь роль участника переговоров в тренажёре "Арена переговоров".

Контекст: ${scenario.domain}.
Твоя роль: ${level.opponentRole}.
Твои цели в переговорах: ${level.opponentGoals}.
Тон общения: ${level.opponentTone}.
Сложность: ${DIFFICULTY_NOTE[scenario.difficulty]}

Правила:
- Оставайся в рамках роли и целей на протяжении всего диалога, не соглашайся на условия, противоречащие твоим целям, без веской причины.
- Отвечай живой репликой, как реальный человек в переговорах — без списков и без мета-комментариев о том, что ты ИИ.
- Не сообщай и не подразумевай исход переговоров и не объявляй их завершение — это решает не ИИ.
- Длина реплики — 2-4 предложения.`;
}

function formatHistory(history: HistoryTurn[]): string {
  return history
    .map((t) => `${t.role === "USER" ? "Игрок" : "Оппонент"}: ${t.text}`)
    .join("\n");
}

/**
 * Промпт для classifyAction(). LLM ТОЛЬКО классифицирует последнюю реплику игрока —
 * не решает исход, переход, победу/поражение, текущий уровень/стадию.
 */
export function buildClassifyPrompt(params: {
  scenario: Pick<Scenario, "domain">;
  level: Pick<Level, "opponentRole" | "opponentGoals" | "objective">;
  stage: Pick<Stage, "type">;
  history: HistoryTurn[];
  lastUserMessage: string;
}): string {
  const { scenario, level, stage, history, lastUserMessage } = params;

  return `Ты — классификатор реплик в тренажёре переговоров "Арена переговоров".
Твоя ЕДИНСТВЕННАЯ задача — классифицировать последнюю реплику игрока. Ты не решаешь исход переговоров,
не определяешь победу или поражение, не выбираешь следующий уровень или стадию — это делает другая система.

Контекст: ${scenario.domain}.
Роль собеседника: ${level.opponentRole}, его цели: ${level.opponentGoals}.
Цель игрока на этом этапе: ${level.objective}.
Текущий подэтап переговоров: ${STAGE_NOTE[stage.type]}

История диалога:
${formatHistory(history)}

Последняя реплика игрока: "${lastUserMessage}"

Значение категорий actionType (важно не путать CONCESSION и PRESSURE — это противоположности):
- QUESTION — уточняющий вопрос о ситуации/потребности собеседника.
- ARGUMENT — довод в пользу своего предложения: факты, цифры, кейсы, логическое обоснование.
- CONCESSION — игрок ЧТО-ТО ОТДАЁТ или БЕРЁТ НА СЕБЯ, чтобы снизить риск/сомнения собеседника.
  Это не только скидка по цене — сюда же относится любая форма "мы уступаем/берём риск на себя":
  бесплатный пробный период, гарантия возврата денег, расширенная поддержка без доплаты, более
  мягкие условия оплаты, письменные гарантии, готовность взять на себя ответственность за результат.
  Примеры: "Предлагаю бесплатный пилот на две недели, весь риск на себе"; "Если не сработает — не
  платите"; "Готов зафиксировать это письменно как гарантию".
- PRESSURE — противоположность CONCESSION: игрок ДАВИТ на собеседника без встречной уступки —
  ультиматум, дедлайн, угроза уйти к другому, требование немедленного решения. Если реплика наоборот
  предлагает собеседнику выгоду или снимает с него риск — это CONCESSION, а не PRESSURE, даже если
  тон уверенный. Пример PRESSURE: "Либо подписываем сегодня, либо мы уходим к другому поставщику".
- RAPPORT — построение тёплого контакта: приветствие, благодарность, комплимент, эмпатия — про тон,
  а не про содержание по сути вопроса.
- CLARIFICATION — проверка, правильно ли понял уже сказанное собеседником ("правильно ли я понимаю...").
- NEUTRAL — нейтральная реплика без явного действия из списка выше, не двигающая переговоры.
- ABUSE — оскорбление, мат, неуважительный тон.
- GIBBERISH — бессмысленный или пустой текст.
- OFF_TOPIC — явно не по теме переговоров.

Классифицируй эту реплику:
- actionType — ровно одно значение из списка: ${ACTION_TYPES.join(", ")}.
- quality — число 0-100: насколько сильно и уместно сформулирована реплика для текущего подэтапа
  (0 — слабо/неуместно, 100 — очень сильно и по существу).

Ответь СТРОГО в формате JSON, без пояснений и без markdown-разметки:
{
  "actionType": string,
  "quality": number
}`;
}

const ACTION_REACTION_HINT: Partial<Record<ActionType, string>> = {
  ABUSE:
    "Реплика игрока была оскорбительной/токсичной. Отреагируй твёрдо и профессионально — обозначь, что такой тон неприемлем, без ответной грубости.",
  GIBBERISH: "Реплика игрока бессмысленна или пуста. Вежливо переспроси, что игрок имел в виду.",
  OFF_TOPIC: "Реплика игрока не по теме переговоров. Мягко верни разговор к делу.",
};

/**
 * Промпт для generateOpponentReply(). LLM генерирует ТОЛЬКО текст реплики —
 * состояние, прогресс и переходы уже посчитаны движком до вызова этой функции.
 */
export function buildOpponentReplyPrompt(params: {
  scenario: Pick<Scenario, "domain" | "difficulty">;
  level: Pick<Level, "opponentRole" | "opponentTone" | "opponentGoals">;
  stage: Pick<Stage, "type">;
  state: NegotiationState;
  actionType: ActionType;
  history: HistoryTurn[];
  lastUserMessage: string;
}): string {
  const { scenario, level, stage, state, actionType, history, lastUserMessage } = params;

  const mood = MOOD_TEXT[deriveOpponentMood(state.opponent.trust)];

  const reactionHint = ACTION_REACTION_HINT[actionType];

  return `${buildOpponentSystemPrompt(scenario, level)}

Сейчас вы: ${STAGE_NOTE[stage.type]}
Твоё текущее эмоциональное состояние: ${mood} (не объясняй это игроку напрямую, просто отыгрывай).
${reactionHint ? `\n${reactionHint}\n` : ""}
История диалога:
${formatHistory(history)}

Последняя реплика игрока: "${lastUserMessage}"

Сгенерируй свою следующую реплику как оппонент. Реагируй именно на содержание этой реплики так, чтобы игрок
видел связь между тем, что он сказал, и твоей реакцией. Не оценивай реплику игрока вслух, не сообщай очки или
итог — просто ответь по-человечески, в характере.

Ответь СТРОГО в формате JSON, без пояснений и без markdown-разметки:
{ "reply": string }`;
}

// ---------------------------------------------------------------------------
// generateScenarioDraft — конфигурируемость под контекст (см. ТЗ п.2): администратор задаёт
// сферу/тему, сложность, тон/роль/цели оппонента, а LLM пишет ТОЛЬКО контент (роли, ситуацию,
// формулировки этапов). Числовые параметры баланса (maxRounds/пороги) — не отсюда, их считает
// Engine детерминированно (см. computeLevelBalance в app/api/scenarios/generate/route.ts) —
// LLM не может разбалансировать уровень, даже если предложит неудачные цифры.
export type ScenarioDraftInput = {
  domain: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  opponentRole: string;
  opponentTone: string;
  opponentGoals: string;
};

export type ScenarioDraftStage = { type: Stage["type"]; title: string; description: string };
export type ScenarioDraftLevel = {
  title: string;
  opponentRole: string;
  opponentTone: string;
  opponentGoals: string;
  objective: string;
  openingLine: string;
  stages: ScenarioDraftStage[];
};
export type ScenarioDraft = {
  title: string;
  playerRole: string;
  situation: string;
  successCriteria: string;
  levels: ScenarioDraftLevel[];
};

const STAGE_TYPE_EXPLAIN: Record<Stage["type"], string> = {
  CONTACT: "установление контакта/раппорта",
  DISCOVERY: "выявление ситуации и потребности собеседника",
  PITCH: "презентация решения/предложения",
  OBJECTION: "отработка возражений",
  CLOSING: "закрытие договорённости",
};

export function buildScenarioDraftPrompt(input: ScenarioDraftInput): string {
  return `Ты — генератор игровых сценариев для тренажёра деловых переговоров "Арена переговоров".
Администратор задал контекст, а ты должен придумать законченный, играбельный сценарий на его основе.

Заданный контекст:
- Сфера/тема переговоров: ${input.domain}
- Сложность: ${input.difficulty} (${DIFFICULTY_NOTE[input.difficulty]})
- Роль оппонента (NPC): ${input.opponentRole}
- Тон оппонента: ${input.opponentTone}
- Цели/скрытые интересы оппонента: ${input.opponentGoals}

Придумай:
- title: короткое название сценария.
- playerRole: кто игрок в этой ситуации (не сам оппонент, а собеседник игрока).
- situation: 2-3 предложения — с чего начинается разговор и почему он вообще происходит.
- successCriteria: 1 предложение — что считается успехом для игрока.
- levels: массив ровно из 2 уровней (level), каждый — отдельный логический этап переговоров
  (например: "выйти на нужного человека" -> "договориться с ним по существу", или "первый контакт"
  -> "закрытие сделки" — придумай уместную для контекста пару). Каждый level:
  - title, opponentRole/opponentTone/opponentGoals (могут немного отличаться от заданного контекста
    между level 1 и level 2, если это уместно — например, level 1 это секретарь/привратник, level 2
    уже сам ЛПР; либо оставь тем же человеком, если сценарий про один непрерывный разговор),
  - objective: цель игрока именно на этом level,
  - openingLine: первая реплика оппонента, с которой начинается level,
  - stages: массив из 2-3 подэтапов, каждый — { type, title, description }, где type — ОДНО значение
    строго из списка: CONTACT, DISCOVERY, PITCH, OBJECTION, CLOSING (${Object.entries(STAGE_TYPE_EXPLAIN)
      .map(([t, d]) => `${t} — ${d}`)
      .join("; ")}). Порядок stages должен быть логичным (обычно CONTACT/DISCOVERY раньше, CLOSING —
    последним на level, где сделка фактически закрывается).

Пиши по-русски, конкретно, без канцелярита и без общих фраз — сценарий должен быть сразу играбельным.

Ответь СТРОГО в формате JSON, без пояснений и без markdown-разметки:
{
  "title": string,
  "playerRole": string,
  "situation": string,
  "successCriteria": string,
  "levels": [
    {
      "title": string,
      "opponentRole": string,
      "opponentTone": string,
      "opponentGoals": string,
      "objective": string,
      "openingLine": string,
      "stages": [{ "type": string, "title": string, "description": string }]
    }
  ]
}`;
}

export function buildFeedbackPrompt(params: {
  scenario: Pick<Scenario, "title" | "domain" | "successCriteria">;
  levelHistory: LevelHistoryEntry[];
  history: HistoryTurn[];
  outcome: "deal" | "partial" | "failed";
  overallScore: number;
  stageBreakdown: StageBreakdownFact[];
  keyMoment: KeyMomentFact | null;
}): string {
  const { scenario, levelHistory, history, outcome, overallScore, stageBreakdown, keyMoment } = params;

  const historyText = history
    .map((t) => {
      const suffix =
        t.actionType && t.actionQuality != null
          ? ` (действие: ${t.actionType}, качество: ${t.actionQuality})`
          : "";
      return `${t.role === "USER" ? "Игрок" : "Оппонент"}: ${t.text}${suffix}`;
    })
    .join("\n");

  const levelsText = levelHistory
    .map((l) => `Уровень ${l.levelOrder} "${l.title}": ${l.result === "advanced" ? "пройден" : "провален"} (раундов: ${l.roundsUsed}, итоговый score: ${l.finalScore}).`)
    .join("\n");

  const stageBreakdownText = stageBreakdown
    .map((s) => `${s.label}: средний балл ${s.score}/100 (${s.turnCount} реплик(и))`)
    .join("\n");

  const keyMomentText = keyMoment
    ? `Реплика игрока "${keyMoment.quote}" (действие: ${keyMoment.actionType}, качество: ${keyMoment.actionQuality}) — ${
        keyMoment.positive ? "лучший момент игрока, определивший успех" : "переломный момент, ухудшивший результат"
      }.`
    : "Явного переломного момента не выявлено.";

  return `Ты — тренер по переговорам. Составь итоговый структурированный разбор сессии в тренажёре
"Арена переговоров: ${scenario.title}".

Контекст: ${scenario.domain}. Критерий успеха: ${scenario.successCriteria}.
Исход переговоров, итоговый счёт и балл по каждому этапу уже определены игровой системой (не тобой) —
не меняй, не оспаривай и не придумывай свои цифры, только объясняй их:
исход — ${outcome}, счёт — ${overallScore}/100.

Баллы по этапам:
${stageBreakdownText || "(данных недостаточно)"}

Ключевой момент:
${keyMomentText}

Прогресс по уровням:
${levelsText}

Полная история диалога:
${historyText}

Составь разбор:
- summary: 1-2 предложения — общий итог, ссылаясь на исход "${outcome}".
- strengths: 2-3 конкретных наблюдения, что игрок делал хорошо, со ссылками на реальные реплики.
- improvements: 2-3 конкретных наблюдения, что ухудшило результат.
- keyMomentExplanation: объясни, почему указанная выше реплика повлияла на переговоры именно так (2-3 предложения). Если ключевого момента нет — напиши общий совет по этой сессии.
- betterAnswer: пример одной конкретной более сильной формулировки для похожей ситуации (не для дословной замены, а как ориентир).
- stageComments: массив объектов { label, comment } — по одному короткому комментарию (1 предложение) на каждый этап из списка "Баллы по этапам" выше, объясняющему именно этот балл. label должен ТОЧНО совпадать с названием этапа из списка "Баллы по этапам".

Пиши по-русски, конкретно и по делу, опираясь на реальные реплики игрока, а не общими фразами.

Ответь СТРОГО в формате JSON, без пояснений и без markdown-разметки:
{
  "summary": string,
  "strengths": string,
  "improvements": string,
  "keyMomentExplanation": string,
  "betterAnswer": string,
  "stageComments": [{ "label": string, "comment": string }]
}`;
}
