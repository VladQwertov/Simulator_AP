"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { OpponentCard } from "../../play/[sessionId]/Avatar";

type FirstLevel = {
  title: string;
  opponentRole: string;
  opponentTone: string;
  objective: string;
  // opponentGoals сюда даже не приходит с сервера (см. app/api/scenarios/[id]/preview/route.ts) —
  // это скрытая от игрока информация, а не просто не отрисовывается на странице.
};

type ScenarioPreview = {
  id: string;
  title: string;
  domain: string;
  playerRole: string;
  situation: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  successCriteria: string;
  firstLevel: FirstLevel | null;
};

const DIFFICULTY_META: Record<ScenarioPreview["difficulty"], { label: string; badgeClass: string }> = {
  EASY: { label: "Лёгкий", badgeClass: "bg-green-100 text-green-700" },
  MEDIUM: { label: "Средний", badgeClass: "bg-amber-100 text-amber-700" },
  HARD: { label: "Сложный", badgeClass: "bg-red-100 text-red-700" },
};

function InfoCardSkeleton({ delayMs, lines = 2 }: { delayMs: number; lines?: number }) {
  return (
    <div
      className="animate-fade-slide-up animate-pulse rounded-2xl border border-border bg-white p-5 shadow-sm"
      style={{ "--delay": `${delayMs}ms` } as React.CSSProperties}
    >
      <div className="h-3 w-1/3 rounded bg-background-soft" />
      <div className="mt-3 h-3 w-full rounded bg-background-soft" />
      {lines > 1 && <div className="mt-2 h-3 w-4/5 rounded bg-background-soft" />}
    </div>
  );
}

export default function ScenarioContextPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [scenario, setScenario] = useState<ScenarioPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/scenarios/${id}/preview`)
      .then(async (res) => {
        if (ignore) return;
        if (res.status === 404) {
          setLoadError("Сценарий не найден или ещё не опубликован.");
          return;
        }
        if (!res.ok) {
          setLoadError("Не удалось загрузить сценарий.");
          return;
        }
        const data: ScenarioPreview = await res.json();
        setScenario(data);
      })
      .catch(() => {
        if (!ignore) setLoadError("Проблема с сетью. Обновите страницу.");
      });
    return () => {
      ignore = true;
    };
  }, [id]);

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStartError(data.error ?? "Не удалось начать переговоры");
        setStarting(false);
        return;
      }
      router.push(`/play/${data.sessionId}`);
    } catch {
      setStartError("Проблема с сетью. Попробуйте ещё раз.");
      setStarting(false);
    }
  }

  if (loadError) {
    return (
      <main className="min-h-full bg-background-soft">
        <div className="mx-auto max-w-2xl p-8">
          <p className="text-red-600">{loadError}</p>
          <Link href="/" className="mt-4 inline-block text-primary underline">
            ← К списку сценариев
          </Link>
        </div>
      </main>
    );
  }

  if (!scenario) {
    return (
      <main className="min-h-full bg-background-soft">
        <div className="mx-auto max-w-2xl p-4 pb-8 sm:p-8">
          <div className="h-4 w-32 rounded bg-white" />
          <div className="mt-4 h-7 w-2/3 rounded bg-white" />
          <div className="mt-2 h-4 w-1/2 rounded bg-white" />
          <div className="mt-6 flex flex-col gap-4">
            <InfoCardSkeleton delayMs={0} />
            <InfoCardSkeleton delayMs={70} lines={3} />
            <InfoCardSkeleton delayMs={140} />
          </div>
        </div>
      </main>
    );
  }

  const difficulty = DIFFICULTY_META[scenario.difficulty];
  const firstLevel = scenario.firstLevel;

  return (
    <main className="min-h-full bg-background-soft">
      <div className="mx-auto max-w-2xl p-4 pb-8 sm:p-8">
        <Link href="/" className="text-sm text-muted hover:text-primary hover:underline">
          ← К списку сценариев
        </Link>

        <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-foreground">{scenario.title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted">
          <span>{scenario.domain}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${difficulty.badgeClass}`}>
            {difficulty.label}
          </span>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <div
            className="animate-fade-slide-up rounded-2xl border border-border bg-white p-5 shadow-sm"
            style={{ "--delay": "0ms" } as React.CSSProperties}
          >
            <div className="text-sm font-medium text-muted">Ваша роль</div>
            <p className="mt-1 text-foreground">{scenario.playerRole}</p>

            <div className="mt-4 text-sm font-medium text-muted">Ситуация</div>
            <p className="mt-1 text-foreground">{scenario.situation}</p>
          </div>

          {firstLevel && (
            <div
              className="animate-fade-slide-up rounded-2xl border border-border bg-white p-5 shadow-sm"
              style={{ "--delay": "70ms" } as React.CSSProperties}
            >
              <div className="text-sm font-medium text-muted">С кем вы говорите</div>
              <div className="mt-2">
                <OpponentCard mood="neutral" activity="idle" name={firstLevel.opponentRole} tone={firstLevel.opponentTone} />
              </div>

              <div className="mt-4 text-sm font-medium text-muted">Ваша первая цель</div>
              <p className="mt-1 text-foreground">{firstLevel.objective}</p>
            </div>
          )}

          <div
            className="animate-fade-slide-up rounded-2xl border border-green-200 bg-green-50 p-5"
            style={{ "--delay": "140ms" } as React.CSSProperties}
          >
            <div className="text-sm font-medium text-green-700">Что считается успехом</div>
            <p className="mt-1 text-foreground">{scenario.successCriteria}</p>
          </div>
        </div>

        <button
          className="mt-8 w-full rounded-full bg-primary px-6 py-3 font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50 sm:w-auto"
          onClick={start}
          disabled={starting}
        >
          {starting ? "Запуск..." : "Начать переговоры"}
        </button>

        {startError && <p className="mt-3 text-red-600">{startError}</p>}
      </div>
    </main>
  );
}
