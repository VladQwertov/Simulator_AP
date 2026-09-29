// lib/llm/client.ts
// Три строго разделённые функции:
//  - classifyAction: LLM классифицирует реплику игрока -> { actionType, quality }. Ничего больше.
//  - generateOpponentReply: LLM генерирует только текст реплики NPC. State/переходы не трогает.
//  - generateFeedback: LLM пишет только текстовый разбор уже вычисленного движком исхода.
// У каждой есть детерминированный fallback (MOCK_LLM=true или сбой сети/API) — движок и игровой
// цикл работают одинаково в обоих случаях, меняется только качество текста.
import type { Level, Scenario, Stage } from "@prisma/client";
import {
  ACTION_TYPES,
  type ActionType,
  type KeyMomentFact,
  type LevelHistoryEntry,
  type NegotiationState,
  type StageBreakdownFact,
} from "@/lib/engine";
import {
  buildClassifyPrompt,
  buildFeedbackPrompt,
  buildOpponentReplyPrompt,
  buildScenarioDraftPrompt,
  type FeedbackResult,
  type HistoryTurn,
  type ScenarioDraft,
  type ScenarioDraftInput,
  type ScenarioDraftLevel,
  type ScenarioDraftStage,
} from "./prompts";

// llama-3.3-70b-versatile снята с поддержки на Groq (404 model_not_found) — проверено вживую
// через GET /openai/v1/models, актуальная замена того же класса — openai/gpt-oss-120b.
const MODEL = process.env.LLM_MODEL ?? "openai/gpt-oss-120b";

function isMock(): boolean {
  // Читается на каждый вызов (а не один раз при импорте модуля), чтобы MOCK_LLM
  // можно было переключать между тестами без пересборки модуля.
  return process.env.MOCK_LLM === "true";
}

function clampQuality(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

export type ClassifyResult = { actionType: ActionType; quality: number };

// classifyAction — задача классификации, а не творческого письма: ей нужна низкая температура
// (почти детерминированная), иначе одна и та же реплика в разных вызовах получает разный
// actionType просто из-за сэмплинга — воспроизведено вживую (одни и те же формулировки уступки
// то ловились как CONCESSION, то как NEUTRAL/PRESSURE в разных прогонах). generateOpponentReply/
// generateFeedback — наоборот, творческий текст, там разумная вариативность (0.7) уместна.
const CLASSIFY_TEMPERATURE = 0.15;
const CREATIVE_TEMPERATURE = 0.7;

async function callLLM(prompt: string, temperature: number = CREATIVE_TEMPERATURE): Promise<string> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.error("Не удалось распарсить ответ LLM, использую fallback:", err, raw);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// classifyAction
// ---------------------------------------------------------------------------

function isValidActionType(value: unknown): value is ActionType {
  return typeof value === "string" && (ACTION_TYPES as readonly string[]).includes(value);
}

/**
 * Строго проверяет, что сырой ответ LLM содержит ТОЛЬКО валидный actionType/quality.
 * Любые другие поля (outcome, isEnding, currentLevel, ...), даже если LLM их вернула,
 * сюда не попадают — функция читает исключительно эти два ключа.
 */
function toValidClassifyResult(raw: unknown): ClassifyResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!isValidActionType(obj.actionType)) return null;
  if (typeof obj.quality !== "number" || Number.isNaN(obj.quality)) return null;
  return { actionType: obj.actionType, quality: clampQuality(obj.quality) };
}

const ACTION_KEYWORDS: [RegExp, ActionType][] = [
  [/скидк|уступ|снизи(м|ть)?|пойд[её]м навстречу|готов[а]? уступить/i, "CONCESSION"],
  [/либо\s|иначе|крайний срок|срок истекает|в противном случае|уйд[её]м|откажемся|последний шанс/i, "PRESSURE"],
  [/правильно ли я понима|то есть вы|уточн|поясни|если я правильно понял/i, "CLARIFICATION"],
  [/потому что|поэтому|это позволит|данные показывают|опыт показывает|доказыва|исследовани/i, "ARGUMENT"],
  [/рад(ы)? знакомству|приятно|спасибо|отлично|здравствуй|добрый день|добрый вечер|привет/i, "RAPPORT"],
];

// Небольшой курируемый список — не претендует на полноту (это не модерация контента), но ловит
// явные оскорбления и мат. Проверено вживую: реальная LLM-классификация одного и того же грубого
// слова ("хуй", "ты пидор") в разных раундах то распознавала ABUSE, то нет — токсичный тон не должен
// зависеть от настроения модели, поэтому этот паттерн проверяется ДО обращения к LLM (см. classifyAction).
// \b (word boundary) в JS-регулярках определяется только по ASCII \w и не работает с кириллицей —
// но и голые подстроки без всякой защиты границ ловят живые ложные срабатывания: "рублях" содержит
// "бля", "сосиски"/"лохотрон" содержат "соси"/"лох" — воспроизведено вживую (обсуждение цены в рублях
// в реальной сессии получило ABUSE и оборвало доверие). Поэтому границы проверяются вручную через
// (?<![а-яё])...(?![а-яё]) — не кириллица ни до, ни после совпадения. Плата — словоформы с суффиксами
// ("лоха", "хуёв") не ловятся, только исходная и уже перечисленные явно; это осознанный компромисс:
// это предохранитель, а не полная модерация (см. комментарий у fallbackClassify), ложный ОТРИЦАТЕЛЬНЫЙ
// результат ещё может поймать LLM-классификатор ниже, а ложный ПОЛОЖИТЕЛЬНЫЙ — ломает игру необратимо.
const ABUSE_PATTERN =
  /(?<![а-яё])(?:лох|дура(?:к|шка)?|идиот|тупо[йя]|соси|мраз|сволоч|урод|дебил|ненавиж|пош[её]л|заткнись|ху[йеяё]|пизд|[её]бат|бля[дт]?|мудак|мудил|гандон|гондон|пидор|пидар|сука|суки)(?![а-яё])/i;

// Уступки (CONCESSION) — LLM ненадёжно распознаёт их даже с явными определениями в промпте
// (см. buildClassifyPrompt) и низкой температурой классификации: воспроизведено вживую — одни
// и те же textbook-формулировки ("Дарю", "Снижаю", "Беру на себя") в разных прогонах то ловились
// как CONCESSION, то как NEUTRAL/ARGUMENT. Явные лексические признаки уступки поэтому применяются
// как ПЕРЕОПРЕДЕЛЕНИЕ actionType поверх результата LLM (quality от LLM сохраняется — оценка силы
// формулировки у модели адекватная, ненадёжна именно категория) — но не когда реплика вопрос:
// "Дадите ли скидку?" — это QUESTION про чужую уступку, а не собственная уступка игрока.
const CONCESSION_OVERRIDE_PATTERN =
  /(?<![а-яё])(?:уступ|дарю|дарим|сниж|скидк|бесплатн)|беру на себя|возьму на себя|берём на себя|без предоплаты|без доплаты|гарантию возврата|гарантия возврата|весь риск/i;

function isExplicitConcession(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.includes("?")) return false;
  return CONCESSION_OVERRIDE_PATTERN.test(trimmed.toLowerCase());
}

// Явно не по теме деловых переговоров — не исчерпывающе, только самые частые отвлечения.
const OFF_TOPIC_PATTERN = /погод[аеу]|футбол|сериал|как дела\??$|что делаешь|анекдот|гороскоп/i;

const GIBBERISH_MAX_LENGTH = 2;

/**
 * Простая эвристика без внешних вызовов: по ключевым словам определяет ActionType,
 * по длине сообщения — грубую оценку quality. Не NLP, но всегда возвращает валидный результат
 * и никогда не ломает игровой цикл.
 *
 * Порядок проверок важен: ABUSE/GIBBERISH — принудительные категории (не переговорное действие),
 * определяются раньше обычных ключевых слов.
 */
export function fallbackClassify(message: string): ClassifyResult {
  const trimmed = message.trim();
  const text = trimmed.toLowerCase();

  if (ABUSE_PATTERN.test(text)) {
    return { actionType: "ABUSE", quality: 0 };
  }
  if (trimmed.length <= GIBBERISH_MAX_LENGTH) {
    return { actionType: "GIBBERISH", quality: 0 };
  }

  let actionType: ActionType = /\?/.test(text) ? "QUESTION" : "NEUTRAL";
  let matched = false;
  for (const [pattern, type] of ACTION_KEYWORDS) {
    if (pattern.test(text)) {
      actionType = type;
      matched = true;
      break;
    }
  }
  if (!matched && actionType === "NEUTRAL" && OFF_TOPIC_PATTERN.test(text)) {
    actionType = "OFF_TOPIC";
  }

  const quality = clampQuality(35 + Math.min(trimmed.length, 240) / 4);

  return { actionType, quality };
}

// ---------------------------------------------------------------------------
// generateScenarioDraft
// ---------------------------------------------------------------------------

const VALID_STAGE_TYPES = ["CONTACT", "DISCOVERY", "PITCH", "OBJECTION", "CLOSING"] as const;

function isValidStageType(value: unknown): value is ScenarioDraftStage["type"] {
  return typeof value === "string" && (VALID_STAGE_TYPES as readonly string[]).includes(value);
}

/**
 * Полностью детерминированный офлайн-черновик (MOCK_LLM=true или сбой LLM) — та же структура,
 * что и у настоящей генерации, просто текст простой/шаблонный, а не творческий. Игра всё равно
 * получает валидный, играбельный сценарий без обращения к сети.
 */
function fallbackScenarioDraft(input: ScenarioDraftInput): ScenarioDraft {
  const { domain, opponentRole, opponentTone, opponentGoals } = input;
  return {
    title: `Переговоры: ${domain}`,
    playerRole: `Специалист, ведущий переговоры по теме «${domain}»`,
    situation: `Вам предстоит провести переговоры с собеседником в роли «${opponentRole}» по теме «${domain}». Собеседник настроен ${opponentTone.toLowerCase()}.`,
    successCriteria: "Собеседник согласился на конкретный следующий шаг по итогам разговора",
    levels: [
      {
        title: "Установить контакт и понять ситуацию",
        opponentRole,
        opponentTone,
        opponentGoals,
        objective: "Расположить собеседника к себе и выяснить его реальную ситуацию/потребность",
        openingLine: `Добрый день. Прежде чем продолжить — объясните конкретно, зачем нам этот разговор.`,
        stages: [
          { type: "CONTACT", title: "Установить контакт", description: "Расположить собеседника к себе, обозначить цель разговора" },
          { type: "DISCOVERY", title: "Понять ситуацию", description: "Выяснить реальную потребность и ограничения собеседника" },
        ],
      },
      {
        title: "Предложить решение и закрыть договорённость",
        opponentRole,
        opponentTone,
        opponentGoals,
        objective: "Показать, что предложение закрывает потребность собеседника, и зафиксировать следующий шаг",
        openingLine: "Хорошо, теперь по существу — что конкретно вы предлагаете?",
        stages: [
          { type: "PITCH", title: "Презентовать решение", description: "Показать, как предложение закрывает выявленную потребность" },
          { type: "CLOSING", title: "Закрыть договорённость", description: "Зафиксировать конкретный следующий шаг" },
        ],
      },
    ],
  };
}

function sanitizeStage(raw: unknown): ScenarioDraftStage | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!isValidStageType(obj.type)) return null;
  return {
    type: obj.type,
    title: typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : STAGE_TYPE_LABEL_FALLBACK[obj.type],
    description: typeof obj.description === "string" ? obj.description.trim() : "",
  };
}

const STAGE_TYPE_LABEL_FALLBACK: Record<ScenarioDraftStage["type"], string> = {
  CONTACT: "Установить контакт",
  DISCOVERY: "Понять ситуацию",
  PITCH: "Презентовать решение",
  OBJECTION: "Отработать возражение",
  CLOSING: "Закрыть договорённость",
};

function sanitizeLevel(raw: unknown, input: ScenarioDraftInput): ScenarioDraftLevel | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const stages = Array.isArray(obj.stages) ? obj.stages.map(sanitizeStage).filter((s): s is ScenarioDraftStage => s !== null) : [];
  if (stages.length === 0) return null;

  return {
    title: typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "Этап переговоров",
    opponentRole: typeof obj.opponentRole === "string" && obj.opponentRole.trim() ? obj.opponentRole.trim() : input.opponentRole,
    opponentTone: typeof obj.opponentTone === "string" && obj.opponentTone.trim() ? obj.opponentTone.trim() : input.opponentTone,
    opponentGoals: typeof obj.opponentGoals === "string" && obj.opponentGoals.trim() ? obj.opponentGoals.trim() : input.opponentGoals,
    objective: typeof obj.objective === "string" && obj.objective.trim() ? obj.objective.trim() : "Продвинуть переговоры вперёд",
    openingLine: typeof obj.openingLine === "string" && obj.openingLine.trim() ? obj.openingLine.trim() : "Слушаю вас.",
    stages,
  };
}

/**
 * Проверяет и досоздаёт сырой ответ LLM до валидного ScenarioDraft. Любое поле, которое LLM не
 * прислала или прислала в неверном формате, подменяется разумным дефолтом — генерация никогда
 * не должна упасть с ошибкой из-за одного плохого поля, только деградировать по качеству текста.
 */
function toScenarioDraft(raw: unknown, input: ScenarioDraftInput): ScenarioDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const levels = Array.isArray(obj.levels)
    ? obj.levels.map((l) => sanitizeLevel(l, input)).filter((l): l is ScenarioDraftLevel => l !== null)
    : [];
  if (levels.length === 0) return null;

  return {
    title: typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : `Переговоры: ${input.domain}`,
    playerRole: typeof obj.playerRole === "string" && obj.playerRole.trim() ? obj.playerRole.trim() : "Специалист, ведущий переговоры",
    situation: typeof obj.situation === "string" && obj.situation.trim() ? obj.situation.trim() : `Переговоры по теме «${input.domain}».`,
    successCriteria:
      typeof obj.successCriteria === "string" && obj.successCriteria.trim()
        ? obj.successCriteria.trim()
        : "Собеседник согласился на конкретный следующий шаг",
    levels,
  };
}

export async function generateScenarioDraft(input: ScenarioDraftInput): Promise<ScenarioDraft> {
  const fallback = fallbackScenarioDraft(input);
  if (isMock()) return fallback;

  try {
    const prompt = buildScenarioDraftPrompt(input);
    const raw = await callLLM(prompt);
    const parsed = parseJSON<Record<string, unknown>>(raw, {});
    return toScenarioDraft(parsed, input) ?? fallback;
  } catch (err) {
    console.error("generateScenarioDraft упал, отдаю fallback:", err);
    return fallback;
  }
}

export async function classifyAction(params: {
  scenario: Pick<Scenario, "domain">;
  level: Pick<Level, "opponentRole" | "opponentGoals" | "objective">;
  stage: Pick<Stage, "type">;
  history: HistoryTurn[];
  lastUserMessage: string;
}): Promise<ClassifyResult> {
  // Мат/оскорбления детектируются детерминированно и ПЕРЕД обращением к LLM — see комментарий
  // у ABUSE_PATTERN: одна и та же грубая реплика не должна то ловиться, то нет, в зависимости
  // от того, как в этот раз ответила модель. Заодно экономит вызов LLM на явном случае.
  const deterministicGuess = fallbackClassify(params.lastUserMessage);
  if (deterministicGuess.actionType === "ABUSE") return deterministicGuess;

  // Явная уступка — переопределяет actionType результата (quality остаётся от LLM/fallback),
  // см. комментарий у CONCESSION_OVERRIDE_PATTERN.
  const forceConcession = isExplicitConcession(params.lastUserMessage);
  const applyConcessionOverride = (result: ClassifyResult): ClassifyResult =>
    forceConcession ? { ...result, actionType: "CONCESSION" } : result;

  if (isMock()) return applyConcessionOverride(deterministicGuess);

  try {
    const prompt = buildClassifyPrompt(params);
    const raw = await callLLM(prompt, CLASSIFY_TEMPERATURE);
    const parsed = parseJSON<Record<string, unknown>>(raw, {});
    return applyConcessionOverride(toValidClassifyResult(parsed) ?? deterministicGuess);
  } catch (err) {
    console.error("classifyAction упал, отдаю fallback:", err);
    return applyConcessionOverride(deterministicGuess);
  }
}

// ---------------------------------------------------------------------------
// generateOpponentReply
// ---------------------------------------------------------------------------

// Реплики сгруппированы по тому, что реально произошло (тип действия/настроение оппонента),
// а не выбираются "по кругу" — так fallback-режим тоже показывает причинно-следственную связь
// между действием игрока и реакцией NPC, а не одну и ту же карусель фраз.
const POSITIVE_REPLIES = [
  "Хорошо, это действительно похоже на то, что нам нужно. Продолжайте.",
  "Интересно, расскажите подробнее.",
  "Это меняет дело — что вы предлагаете дальше?",
  "Понимаю вашу логику, звучит убедительно.",
];
const NEUTRAL_REPLIES = [
  "Понимаю вашу позицию. Продолжайте, я слушаю.",
  "Хорошо, но мне нужно больше конкретики, чтобы принять решение.",
  "Это разумно, но пока не убедили меня до конца.",
  "Хм, давайте уточним детали дальше.",
];
const NEGATIVE_REPLIES = [
  "Не уверен, что это решает нашу проблему.",
  "Пока не вижу, чем это лучше того, что у нас уже есть.",
  "Это звучит как общие слова без конкретики.",
  "Мне сложно доверять таким формулировкам.",
];
const ABUSE_REPLIES = [
  "Такой тон недопустим для делового разговора. Предлагаю вернуться к сути, иначе мне придётся закончить встречу.",
  "Если разговор продолжится в таком тоне, я не вижу смысла его продолжать.",
];
const CONFUSED_REPLIES = [
  "Простите, не совсем понял вашу мысль. Могли бы вы пояснить?",
  "Кажется, это не по теме нашего разговора. Вернёмся к делу?",
];

function pickByRound<T>(pool: T[], round: number): T {
  const index = ((round % pool.length) + pool.length) % pool.length;
  return pool[index];
}

export function fallbackOpponentReply(actionType: ActionType, state: NegotiationState): string {
  if (actionType === "ABUSE") return pickByRound(ABUSE_REPLIES, state.round);
  if (actionType === "GIBBERISH" || actionType === "OFF_TOPIC") return pickByRound(CONFUSED_REPLIES, state.round);

  const pool = state.opponent.trust >= 65 ? POSITIVE_REPLIES : state.opponent.trust <= 30 ? NEGATIVE_REPLIES : NEUTRAL_REPLIES;
  return pickByRound(pool, state.round);
}

export async function generateOpponentReply(params: {
  scenario: Pick<Scenario, "domain" | "difficulty">;
  level: Pick<Level, "opponentRole" | "opponentTone" | "opponentGoals">;
  stage: Pick<Stage, "type">;
  state: NegotiationState;
  actionType: ActionType;
  history: HistoryTurn[];
  lastUserMessage: string;
}): Promise<string> {
  if (isMock()) return fallbackOpponentReply(params.actionType, params.state);

  try {
    const prompt = buildOpponentReplyPrompt(params);
    const raw = await callLLM(prompt);
    const parsed = parseJSON<Record<string, unknown>>(raw, {});
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    return reply || fallbackOpponentReply(params.actionType, params.state);
  } catch (err) {
    console.error("generateOpponentReply упал, отдаю fallback:", err);
    return fallbackOpponentReply(params.actionType, params.state);
  }
}

// ---------------------------------------------------------------------------
// generateFeedback
// ---------------------------------------------------------------------------

const OUTCOME_SUMMARY: Record<"deal" | "partial" | "failed", string> = {
  deal: "Переговоры завершились успешно — вы добились согласия собеседника.",
  partial: "Переговоры завершились частичной договорённостью — часть целей достигнута, но не всё.",
  failed: "Переговоры провалились — собеседник не пришёл к согласию.",
};

function stageScoreComment(score: number): string {
  if (score >= 70) return "Уверенно и по существу.";
  if (score >= 50) return "В целом нормально, но можно точнее и конкретнее.";
  return "Слабо — реплики были короткими или общими, не хватало конкретики.";
}

const BETTER_ANSWER_EXAMPLE: Record<string, string> = {
  CONTACT: 'Например: "Добрый день, буду краток — хочу понять, актуальна ли для вас тема X, и если да, обсудить это подробнее."',
  DISCOVERY: 'Например: "Скажите, сколько сейчас времени уходит на обработку одной заявки и что в этом процессе доставляет больше всего проблем?"',
  PITCH: 'Например: "Наше решение сокращает время обработки заявки на N% — вот конкретный пример компании из вашей отрасли."',
  OBJECTION: 'Например: "Понимаю ваше опасение по срокам — давайте зафиксируем пилот на 2 недели с чёткими критериями успеха, чтобы снять риск."',
  CLOSING: 'Например: "Предлагаю зафиксировать демонстрацию на следующей неделе — какой день вам удобен?"',
};

/**
 * Полностью детерминированный, но содержательный fallback — используется при MOCK_LLM=true
 * или если реальный вызов LLM упал/не распарсился. Собирается из уже посчитанных Engine-фактов
 * (stageBreakdown/keyMoment), а не из статичной заглушки — так офлайн-режим не выглядит "урезанным".
 */
function buildFallbackFeedback(params: {
  outcome: "deal" | "partial" | "failed";
  stageBreakdown: StageBreakdownFact[];
  keyMoment: KeyMomentFact | null;
}): FeedbackResult {
  const { outcome, stageBreakdown, keyMoment } = params;

  const sorted = [...stageBreakdown].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  const strengths = best
    ? `Лучше всего получалось на этапе «${best.label}» (средний балл ${best.score}/100) — реплики там были уместными и по существу.`
    : "Вы довели переговоры до конца.";

  const improvements = worst && worst !== best
    ? `Слабее всего — этап «${worst.label}» (средний балл ${worst.score}/100): стоит формулировать реплики там конкретнее.`
    : worst
      ? `Этап «${worst.label}» стоит проработать внимательнее — реплики были слишком общими.`
      : "Подключите реальный LLM (GROQ_API_KEY, MOCK_LLM=false) для более детального разбора.";

  const keyMomentExplanation = keyMoment
    ? keyMoment.positive
      ? `Реплика "${keyMoment.quote}" сработала лучше всего (качество ${keyMoment.actionQuality}/100) — именно такой уровень конкретики сдвигал переговоры вперёд.`
      : keyMoment.actionType === "ABUSE"
        ? `Реплика "${keyMoment.quote}" резко ухудшила отношение собеседника — оскорбления мгновенно роняют доверие.`
        : `Реплика "${keyMoment.quote}" была слабой (качество ${keyMoment.actionQuality}/100) и не продвинула переговоры.`
    : "Явного переломного момента не выявлено — постарайтесь в следующий раз быть более конкретны на каждом этапе.";

  const betterAnswer = worst ? BETTER_ANSWER_EXAMPLE[worst.type] ?? "" : "";

  const stageComments = stageBreakdown.map((s) => ({ label: s.label, comment: stageScoreComment(s.score) }));

  return {
    summary: OUTCOME_SUMMARY[outcome],
    strengths,
    improvements,
    keyMomentExplanation,
    betterAnswer,
    stageComments,
  };
}

/**
 * Явно выбирает только текстовые поля из сырого ответа LLM. overallScore/stageBreakdown[].score
 * (и любое другое поле, если LLM их всё же вернула) сюда физически попасть не могут —
 * функция их не читает, а недостающие/невалидные текстовые поля берутся из fallback.
 */
function toFeedbackResult(raw: unknown, fallback: FeedbackResult): FeedbackResult {
  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;

  const stageComments = Array.isArray(obj.stageComments)
    ? obj.stageComments
        .filter(
          (e): e is { label: string; comment: string } =>
            !!e && typeof e === "object" && typeof (e as Record<string, unknown>).label === "string" &&
            typeof (e as Record<string, unknown>).comment === "string"
        )
        .map((e) => ({ label: e.label, comment: e.comment }))
    : fallback.stageComments;

  return {
    summary: typeof obj.summary === "string" && obj.summary.trim() ? obj.summary : fallback.summary,
    strengths: typeof obj.strengths === "string" && obj.strengths.trim() ? obj.strengths : fallback.strengths,
    improvements:
      typeof obj.improvements === "string" && obj.improvements.trim() ? obj.improvements : fallback.improvements,
    keyMomentExplanation:
      typeof obj.keyMomentExplanation === "string" && obj.keyMomentExplanation.trim()
        ? obj.keyMomentExplanation
        : fallback.keyMomentExplanation,
    betterAnswer:
      typeof obj.betterAnswer === "string" && obj.betterAnswer.trim() ? obj.betterAnswer : fallback.betterAnswer,
    stageComments: stageComments.length > 0 ? stageComments : fallback.stageComments,
  };
}

export async function generateFeedback(params: {
  scenario: Pick<Scenario, "title" | "domain" | "successCriteria">;
  levelHistory: LevelHistoryEntry[];
  history: HistoryTurn[];
  outcome: "deal" | "partial" | "failed";
  overallScore: number; // уже посчитан детерминированно (calculateOverallScore) — только для контекста промпта
  stageBreakdown: StageBreakdownFact[]; // тоже факт, посчитанный Engine — LLM его не меняет, только комментирует
  keyMoment: KeyMomentFact | null;
}): Promise<FeedbackResult> {
  const fallback = buildFallbackFeedback(params);
  if (isMock()) return fallback;

  try {
    const prompt = buildFeedbackPrompt(params);
    const raw = await callLLM(prompt);
    const parsed = parseJSON<Record<string, unknown>>(raw, {});
    return toFeedbackResult(parsed, fallback);
  } catch (err) {
    console.error("generateFeedback упал, отдаю fallback:", err);
    return fallback;
  }
}
