"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ScenarioListItem = {
  id: string;
  title: string;
  domain: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  isPublished: boolean;
  levelCount: number;
};

export default function AdminScenariosPage() {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<ScenarioListItem[] | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Конфигурируемость под контекст (ТЗ п.2): администратор задаёт сферу/сложность/тон/роль/цели
  // оппонента, а не пишет весь сценарий вручную — по этим параметрам сценарий генерируется целиком
  // (см. app/api/scenarios/generate/route.ts), администратор дорабатывает черновик в редакторе.
  const [genDomain, setGenDomain] = useState("");
  const [genDifficulty, setGenDifficulty] = useState<"EASY" | "MEDIUM" | "HARD">("MEDIUM");
  const [genOpponentRole, setGenOpponentRole] = useState("");
  const [genOpponentTone, setGenOpponentTone] = useState("");
  const [genOpponentGoals, setGenOpponentGoals] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/scenarios");
    setScenarios(await res.json());
  }

  useEffect(() => {
    let ignore = false;
    fetch("/api/scenarios")
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) setScenarios(data);
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function createScenario() {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    const res = await fetch("/api/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, domain: "", successCriteria: "", isPublished: false }),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) {
      setError(data.error ?? "Не удалось создать сценарий");
      return;
    }
    setTitle("");
    await load();
  }

  async function generateScenario() {
    if (!genDomain.trim() || !genOpponentRole.trim() || !genOpponentTone.trim() || !genOpponentGoals.trim()) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/scenarios/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: genDomain,
          difficulty: genDifficulty,
          opponentRole: genOpponentRole,
          opponentTone: genOpponentTone,
          opponentGoals: genOpponentGoals,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.error ?? "Не удалось сгенерировать сценарий");
        setGenerating(false);
        return;
      }
      // Черновик создан неопубликованным — сразу открываем редактор для проверки/правок.
      router.push(`/admin/scenarios/${data.id}`);
    } catch {
      setGenError("Проблема с сетью. Попробуйте ещё раз.");
      setGenerating(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold mb-6">Сценарии</h1>

      <section className="mb-8 rounded border border-black/10 p-4 dark:border-white/10">
        <h2 className="mb-1 text-lg font-semibold">Сгенерировать сценарий по контексту</h2>
        <p className="mb-3 text-sm text-black/60 dark:text-white/60">
          Задайте сферу/тему, сложность, роль/тон/цели оппонента — сценарий (роли, ситуация, уровни,
          этапы) будет сгенерирован автоматически и создан как черновик для проверки перед публикацией.
        </p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-0.5 block text-xs text-black/60 dark:text-white/60">
              Сфера/тема переговоров
            </label>
            <input
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm dark:border-white/20 dark:bg-transparent"
              placeholder="Например: аренда коммерческой недвижимости"
              value={genDomain}
              onChange={(e) => setGenDomain(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-0.5 block text-xs text-black/60 dark:text-white/60">
                Роль оппонента
              </label>
              <input
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm dark:border-white/20 dark:bg-transparent"
                placeholder="Например: собственник помещения"
                value={genOpponentRole}
                onChange={(e) => setGenOpponentRole(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-black/60 dark:text-white/60">
                Тон оппонента
              </label>
              <input
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm dark:border-white/20 dark:bg-transparent"
                placeholder="Например: настороженный, торгуется по цене"
                value={genOpponentTone}
                onChange={(e) => setGenOpponentTone(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-0.5 block text-xs text-black/60 dark:text-white/60">
              Цели/скрытые интересы оппонента
            </label>
            <textarea
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm dark:border-white/20 dark:bg-transparent"
              rows={2}
              placeholder="Например: хочет максимальную ставку и минимальный ремонт за свой счёт"
              value={genOpponentGoals}
              onChange={(e) => setGenOpponentGoals(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-black/60 dark:text-white/60">Сложность</label>
            <select
              className="rounded border border-black/20 px-2 py-1.5 text-sm dark:border-white/20 dark:bg-transparent"
              value={genDifficulty}
              onChange={(e) => setGenDifficulty(e.target.value as "EASY" | "MEDIUM" | "HARD")}
            >
              <option value="EASY">EASY</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HARD">HARD</option>
            </select>
            <button
              className="ml-auto rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
              onClick={generateScenario}
              disabled={
                generating ||
                !genDomain.trim() ||
                !genOpponentRole.trim() ||
                !genOpponentTone.trim() ||
                !genOpponentGoals.trim()
              }
            >
              {generating ? "Генерирую..." : "Сгенерировать"}
            </button>
          </div>
          {genError && <p className="text-sm text-red-600">{genError}</p>}
        </div>
      </section>

      <h2 className="mb-2 text-sm font-medium text-black/60 dark:text-white/60">
        ...или создать пустой черновик вручную
      </h2>
      <div className="mb-8 flex gap-2">
        <input
          className="flex-1 rounded border border-black/20 px-3 py-2 dark:border-white/20"
          placeholder="Название нового сценария"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createScenario()}
        />
        <button
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
          onClick={createScenario}
          disabled={creating || !title.trim()}
        >
          {creating ? "Создание..." : "Создать сценарий"}
        </button>
      </div>
      {error && <p className="mb-4 text-red-600">{error}</p>}

      {scenarios === null && <p>Загрузка...</p>}
      {scenarios?.length === 0 && <p className="text-black/60 dark:text-white/60">Сценариев пока нет.</p>}

      <ul className="flex flex-col gap-3">
        {scenarios?.map((s) => (
          <li key={s.id} className="rounded border border-black/10 p-4 dark:border-white/10">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">{s.title}</div>
                <div className="text-sm text-black/60 dark:text-white/60">
                  {s.domain || "—"} · {s.difficulty} · {s.levelCount} уровней ·{" "}
                  {s.isPublished ? "опубликован" : "черновик"}
                </div>
              </div>
              <Link
                className="shrink-0 rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/20"
                href={`/admin/scenarios/${s.id}`}
              >
                Редактировать
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
