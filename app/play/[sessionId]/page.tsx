"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { OpponentAvatar, type AvatarActivity } from "./Avatar";
import type { OpponentMood } from "@/lib/engine";

type Turn = { role: "USER" | "OPPONENT"; text: string };

type SessionView = {
  sessionId: string;
  scenarioTitle: string;
  levelCount: number;
  currentLevel: number;
  currentLevelTitle: string | null;
  currentLevelObjective: string | null;
  currentStage: number;
  currentStageTitle: string | null;
  round: number;
  maxRounds: number;
  outcome: "deal" | "partial" | "failed" | null;
  isEnding: boolean;
  opponentMood: OpponentMood;
  turns: Turn[];
};

type TurnResponse = {
  opponentReply: string;
  transition: "continue" | "advance-stage" | "advance-level" | "fail-level" | "finish";
  scenarioTitle: string;
  levelCount: number;
  currentLevel: number;
  currentLevelTitle: string;
  currentLevelObjective: string;
  currentStage: number;
  currentStageTitle: string | null;
  round: number;
  maxRounds: number;
  outcome: SessionView["outcome"];
  isEnding: boolean;
  opponentMood: OpponentMood;
};

// Как долго держим "speaking" после того, как реплика оппонента пришла — чисто визуальный
// эффект (пока не связан с реальной длительностью TTS/озвучки, которой пока нет).
const SPEAKING_DURATION_MS = 1400;

type StageBreakdownEntry = { type: string; label: string; score: number; turnCount: number; comment: string };

type Feedback = {
  outcome: "deal" | "partial" | "failed";
  summary: string;
  strengths: string;
  improvements: string;
  overallScore: number;
  keyMomentQuote: string | null;
  keyMomentExplanation: string | null;
  betterAnswer: string | null;
  perLevelBreakdown: { levelOrder: number; title: string; result: "advanced" | "failed"; roundsUsed: number; finalScore: number }[] | null;
  stageBreakdown: StageBreakdownEntry[] | null;
};

const OUTCOME_META: Record<NonNullable<SessionView["outcome"]>, { text: string; textCls: string; bgCls: string; borderCls: string }> = {
  deal: { text: "Сделка заключена", textCls: "text-green-700", bgCls: "bg-green-50", borderCls: "border-green-200" },
  partial: { text: "Частичная договорённость", textCls: "text-amber-700", bgCls: "bg-amber-50", borderCls: "border-amber-200" },
  failed: { text: "Переговоры провалены", textCls: "text-red-700", bgCls: "bg-red-50", borderCls: "border-red-200" },
};

function scoreBarClass(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

export default function PlaySessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);

  const [data, setData] = useState<SessionView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [levelBanner, setLevelBanner] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [activity, setActivity] = useState<AvatarActivity>("idle");
  const historyEndRef = useRef<HTMLDivElement>(null);
  const speakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
    };
  }, []);

  async function loadFeedback() {
    setFeedbackError(null);
    const res = await fetch(`/api/sessions/${sessionId}/feedback`);
    const json = await res.json();
    if (!res.ok) {
      setFeedbackError(json.error ?? "Не удалось загрузить разбор переговоров");
      return;
    }
    setFeedback(json);
  }

  useEffect(() => {
    let ignore = false;
    fetch(`/api/sessions/${sessionId}`)
      .then(async (res) => {
        if (ignore) return;
        if (res.status === 404) {
          setLoadError("Сессия не найдена. Возможно, ссылка устарела.");
          return;
        }
        if (!res.ok) {
          setLoadError("Не удалось загрузить сессию. Попробуйте обновить страницу.");
          return;
        }
        const json: SessionView = await res.json();
        setData(json);
        if (json.isEnding) await loadFeedback();
      })
      .catch(() => {
        if (!ignore) setLoadError("Проблема с сетью. Проверьте соединение и обновите страницу.");
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.turns.length, sending]);

  async function sendTurn() {
    const message = input.trim();
    if (!message || sending || !data || data.isEnding) return;

    setSending(true);
    setSendError(null);
    setActivity("listening");

    try {
      const res = await fetch(`/api/sessions/${sessionId}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const json = await res.json();

      if (!res.ok) {
        setSendError(json.error ?? "Не удалось отправить сообщение");
        setSending(false);
        setActivity("idle");
        return;
      }

      const turnJson = json as TurnResponse;
      setData((prev) =>
        prev
          ? {
              ...prev,
              turns: [...prev.turns, { role: "USER", text: message }, { role: "OPPONENT", text: turnJson.opponentReply }],
              currentLevel: turnJson.currentLevel,
              currentLevelTitle: turnJson.currentLevelTitle,
              currentLevelObjective: turnJson.currentLevelObjective,
              currentStage: turnJson.currentStage,
              currentStageTitle: turnJson.currentStageTitle,
              round: turnJson.round,
              maxRounds: turnJson.maxRounds,
              outcome: turnJson.outcome,
              isEnding: turnJson.isEnding,
              opponentMood: turnJson.opponentMood,
            }
          : prev
      );
      setInput("");

      setActivity("speaking");
      if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = setTimeout(() => setActivity("idle"), SPEAKING_DURATION_MS);

      if (turnJson.transition === "advance-level") {
        setLevelBanner(turnJson.currentLevelTitle);
        setTimeout(() => setLevelBanner(null), 4000);
      }

      if (turnJson.isEnding) {
        await loadFeedback();
      }
    } catch {
      setSendError("Проблема с сетью. Попробуйте ещё раз.");
      setActivity("idle");
    } finally {
      setSending(false);
    }
  }

  if (loadError) {
    return (
      <main className="min-h-full bg-background-soft">
        <div className="mx-auto max-w-2xl p-8">
          <p className="text-red-600">{loadError}</p>
          <Link href="/" className="mt-4 inline-block text-primary underline">
            ← Выбрать сценарий
          </Link>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-full bg-background-soft">
        <div className="mx-auto max-w-2xl p-8">
          <p className="text-muted">Загрузка сессии...</p>
        </div>
      </main>
    );
  }

  const progressPct = data.maxRounds > 0 ? Math.min(100, Math.round((data.round / data.maxRounds) * 100)) : 0;

  return (
    <main className="min-h-full bg-background-soft">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-8 sm:p-8">
        <div>
          <Link href="/" className="text-sm text-muted hover:text-primary hover:underline">
            ← {data.scenarioTitle}
          </Link>
          <div
            className="mt-2 flex items-center gap-4 rounded-3xl p-4"
            style={{ background: "linear-gradient(160deg, var(--accent-blue), var(--accent-pink))" }}
          >
            <OpponentAvatar mood={data.opponentMood} activity={data.isEnding ? "idle" : activity} size={112} />
            <div className="min-w-0 flex-1">
              {data.currentLevelTitle && (
                <div className="truncate font-bold text-foreground">{data.currentLevelTitle}</div>
              )}
              <div className="mt-0.5 flex items-center justify-between text-sm text-muted">
                <span>
                  Уровень {data.currentLevel}/{data.levelCount}
                </span>
                <span>
                  Раунд {data.round}/{data.maxRounds}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/70">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          </div>
        </div>

        {(data.currentStageTitle || data.currentLevelObjective) && !data.isEnding && (
          <div className="rounded-2xl border border-border bg-white p-3 text-sm shadow-sm">
            {data.currentStageTitle && (
              <div className="font-medium text-foreground">Текущий этап: {data.currentStageTitle}</div>
            )}
            {data.currentLevelObjective && (
              <div className="mt-0.5 text-muted">Цель: {data.currentLevelObjective}</div>
            )}
          </div>
        )}

        {levelBanner && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-3 text-center text-sm text-green-700">
            Уровень завершён! Следующая задача: <span className="font-medium">{levelBanner}</span>
          </div>
        )}

        <div className="flex min-h-[16rem] flex-col gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm">
          {data.turns.map((t, i) => (
            <div key={i} className={`flex ${t.role === "USER" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                  t.role === "USER" ? "bg-primary text-white" : "bg-background-soft text-foreground"
                }`}
              >
                {t.text}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-background-soft px-3.5 py-2 text-sm italic text-muted">
                Собеседник думает...
              </div>
            </div>
          )}
          <div ref={historyEndRef} />
        </div>

        {sendError && (
          <div className="flex items-center justify-between rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-600">
            <span>{sendError}</span>
            <button className="ml-3 shrink-0 underline" onClick={sendTurn}>
              Повторить
            </button>
          </div>
        )}

        {!data.isEnding && (
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-full border border-border bg-white px-4 py-2 outline-none focus:border-primary"
              placeholder="Ваша реплика..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !sending && sendTurn()}
              disabled={sending}
            />
            <button
              className="shrink-0 rounded-full bg-primary px-5 py-2 font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
              onClick={sendTurn}
              disabled={sending || !input.trim()}
            >
              {sending ? "..." : "Отправить"}
            </button>
          </div>
        )}

        {data.isEnding && (
          <section className="mt-2">
            <h2 className="text-lg font-bold text-foreground">Итоги переговоров</h2>

            {!feedback && !feedbackError && (
              <div className="mt-3 flex flex-col gap-4">
                <div className="animate-fade-slide-up animate-pulse rounded-2xl border border-border bg-white p-6 shadow-sm">
                  <div className="mx-auto h-6 w-40 rounded-full bg-background-soft" />
                  <div className="mx-auto mt-4 h-10 w-20 rounded bg-background-soft" />
                </div>
                <p className="text-center text-sm text-muted">Готовим разбор...</p>
              </div>
            )}

            {feedbackError && (
              <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-600">
                <p>{feedbackError}</p>
                <button className="mt-2 underline" onClick={loadFeedback}>
                  Повторить
                </button>
              </div>
            )}

            {feedback && (
              <div className="mt-3 flex flex-col gap-4">
                <div
                  className="animate-fade-slide-up rounded-2xl border border-border bg-white p-6 text-center shadow-sm"
                  style={{ "--delay": "0ms" } as React.CSSProperties}
                >
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${OUTCOME_META[feedback.outcome].bgCls} ${OUTCOME_META[feedback.outcome].borderCls} ${OUTCOME_META[feedback.outcome].textCls}`}
                  >
                    {OUTCOME_META[feedback.outcome].text}
                  </span>
                  <div className="mt-4 text-5xl font-extrabold tabular-nums text-foreground">{feedback.overallScore}</div>
                  <div className="text-sm text-muted">из 100</div>
                  <div className="mx-auto mt-3 h-2 w-48 overflow-hidden rounded-full bg-background-soft">
                    <div
                      className={`h-full rounded-full transition-all ${scoreBarClass(feedback.overallScore)}`}
                      style={{ width: `${feedback.overallScore}%` }}
                    />
                  </div>
                  <p className="mt-4 text-sm text-muted">{feedback.summary}</p>
                </div>

                <div
                  className="animate-fade-slide-up grid grid-cols-1 gap-4 sm:grid-cols-2"
                  style={{ "--delay": "70ms" } as React.CSSProperties}
                >
                  <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
                    <div className="text-sm font-medium text-green-700">Что вы делали хорошо</div>
                    <p className="mt-1 text-sm text-foreground">{feedback.strengths}</p>
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-sm font-medium text-amber-700">Что ухудшило результат</div>
                    <p className="mt-1 text-sm text-foreground">{feedback.improvements}</p>
                  </div>
                </div>

                {feedback.keyMomentExplanation && (
                  <div
                    className="animate-fade-slide-up rounded-2xl border border-border bg-white p-4 shadow-sm"
                    style={{ "--delay": "140ms" } as React.CSSProperties}
                  >
                    <div className="text-sm font-medium text-muted">Ключевой момент</div>
                    {feedback.keyMomentQuote && (
                      <p className="mt-1.5 text-sm italic text-foreground">«{feedback.keyMomentQuote}»</p>
                    )}
                    <p className="mt-1.5 text-sm text-muted">{feedback.keyMomentExplanation}</p>
                  </div>
                )}

                {feedback.betterAnswer && (
                  <div
                    className="animate-fade-slide-up rounded-2xl border border-border bg-white p-4 shadow-sm"
                    style={{ "--delay": "180ms" } as React.CSSProperties}
                  >
                    <div className="text-sm font-medium text-muted">Как можно было ответить лучше</div>
                    <p className="mt-1 text-sm text-foreground">{feedback.betterAnswer}</p>
                  </div>
                )}

                {feedback.stageBreakdown && feedback.stageBreakdown.length > 0 && (
                  <div
                    className="animate-fade-slide-up rounded-2xl border border-border bg-white p-4 shadow-sm"
                    style={{ "--delay": "220ms" } as React.CSSProperties}
                  >
                    <div className="text-sm font-medium text-muted">По этапам</div>
                    <ul className="mt-2 flex flex-col gap-3 text-sm">
                      {feedback.stageBreakdown.map((s) => (
                        <li key={s.type}>
                          <div className="flex items-baseline justify-between">
                            <span className="font-medium text-foreground">{s.label}</span>
                            <span className="text-muted">{s.score}/100</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-background-soft">
                            <div className={`h-full rounded-full ${scoreBarClass(s.score)}`} style={{ width: `${s.score}%` }} />
                          </div>
                          {s.comment && <p className="mt-1 text-muted">{s.comment}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {feedback.perLevelBreakdown && feedback.perLevelBreakdown.length > 0 && (
                  <div
                    className="animate-fade-slide-up rounded-2xl border border-border bg-white p-4 shadow-sm"
                    style={{ "--delay": "260ms" } as React.CSSProperties}
                  >
                    <div className="text-sm font-medium text-muted">По уровням</div>
                    <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                      {feedback.perLevelBreakdown.map((l) => (
                        <li key={l.levelOrder} className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.result === "advanced" ? "bg-green-500" : "bg-red-500"}`} />
                          <span className="text-muted">
                            Уровень {l.levelOrder} «{l.title}» — {l.result === "advanced" ? "пройден" : "провален"} (раундов:{" "}
                            {l.roundsUsed}, счёт: {l.finalScore})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Link
                  href="/"
                  className="mt-2 inline-block w-full rounded-full bg-primary px-6 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-primary-hover sm:w-fit"
                >
                  Начать заново
                </Link>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
