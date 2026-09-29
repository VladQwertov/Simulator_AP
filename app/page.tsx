"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ScenarioCard = {
  id: string;
  title: string;
  domain: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  successCriteria: string;
  levelCount: number;
};

const DIFFICULTY_META: Record<ScenarioCard["difficulty"], { label: string; badgeClass: string }> = {
  EASY: { label: "Лёгкий", badgeClass: "bg-green-100 text-green-700" },
  MEDIUM: { label: "Средний", badgeClass: "bg-amber-100 text-amber-700" },
  HARD: { label: "Сложный", badgeClass: "bg-red-100 text-red-700" },
};

function ScenarioCardSkeleton({ delayMs }: { delayMs: number }) {
  return (
    <div
      className="animate-fade-slide-up animate-pulse rounded-2xl border border-border bg-white p-5 shadow-sm"
      style={{ "--delay": `${delayMs}ms` } as React.CSSProperties}
    >
      <div className="h-5 w-2/3 rounded bg-background-soft" />
      <div className="mt-2 h-3 w-1/2 rounded bg-background-soft" />
      <div className="mt-3 h-3 w-full rounded bg-background-soft" />
    </div>
  );
}

export default function HomePage() {
  const [scenarios, setScenarios] = useState<ScenarioCard[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let ignore = false;
    fetch("/api/scenarios?published=true")
      .then((res) => {
        if (!res.ok) throw new Error("bad response");
        return res.json();
      })
      .then((data) => {
        if (!ignore) setScenarios(data);
      })
      .catch(() => {
        if (!ignore) setLoadError(true);
      });
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <main className="min-h-full bg-background-soft">
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Арена переговоров</h1>
        <p className="mt-2 text-muted">
          Выберите сценарий и проведите переговоры с виртуальным собеседником — ваши формулировки и
          стратегия реально влияют на исход.
        </p>

        {loadError && (
          <p className="mt-6 text-red-600">
            Не удалось загрузить список сценариев. Проверьте, что backend и база данных запущены, и
            обновите страницу.
          </p>
        )}

        {!loadError && scenarios === null && (
          <div className="mt-6 flex flex-col gap-4">
            <ScenarioCardSkeleton delayMs={0} />
            <ScenarioCardSkeleton delayMs={60} />
          </div>
        )}

        {scenarios?.length === 0 && (
          <p className="mt-6 text-muted">
            Пока нет опубликованных сценариев. Создайте и опубликуйте сценарий в{" "}
            <Link href="/admin" className="text-primary underline">
              /admin
            </Link>
            .
          </p>
        )}

        <div className="mt-6 flex flex-col gap-4">
          {scenarios?.map((s, i) => {
            const difficulty = DIFFICULTY_META[s.difficulty];
            return (
              <div
                key={s.id}
                className="animate-fade-slide-up group rounded-2xl border border-border bg-white p-5 shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md"
                style={{ "--delay": `${i * 70}ms` } as React.CSSProperties}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{s.title}</h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted">
                      <span>{s.domain}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${difficulty.badgeClass}`}>
                        {difficulty.label}
                      </span>
                      <span className="shrink-0 whitespace-nowrap">{s.levelCount} уровня(ей)</span>
                    </div>
                    {s.successCriteria && <p className="mt-2 text-sm text-foreground">{s.successCriteria}</p>}
                  </div>
                  <Link
                    className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white transition-all duration-150 ease-out hover:bg-primary-hover group-hover:translate-x-0.5"
                    href={`/scenario/${s.id}`}
                  >
                    Подробнее →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
