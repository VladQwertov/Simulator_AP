"use client";

import { use, useEffect, useState } from "react";

type StageType = "CONTACT" | "DISCOVERY" | "PITCH" | "OBJECTION" | "CLOSING";
const STAGE_TYPES: StageType[] = ["CONTACT", "DISCOVERY", "PITCH", "OBJECTION", "CLOSING"];

type Stage = {
  id: string;
  order: number;
  type: StageType;
  title: string | null;
  description: string | null;
  // null = основной путь; "soft"/"hard" = развилка — несколько Stage делят один order, движок
  // сам выбирает вариант при игре (lib/engine/transition.ts). Здесь только для отображения:
  // редактирование через админку не создаёт и не переносит развилки, только правит content
  // существующего варианта.
  branchKey: string | null;
};

type Level = {
  id: string;
  order: number;
  title: string;
  opponentRole: string;
  opponentTone: string;
  opponentGoals: string;
  objective: string;
  openingLine: string;
  maxRounds: number;
  advanceThreshold: number;
  failThreshold: number;
  stages: Stage[];
};

type Scenario = {
  id: string;
  title: string;
  domain: string;
  playerRole: string;
  situation: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  successCriteria: string;
  isPublished: boolean;
  levels: Level[];
};

const inputCls = "w-full rounded border border-black/20 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent";
const labelCls = "block text-xs text-black/60 dark:text-white/60 mb-0.5";
const btnCls = "rounded border border-black/20 px-2 py-1 text-xs dark:border-white/20";
const btnDangerCls = "rounded border border-red-600/40 px-2 py-1 text-xs text-red-600";
const btnPrimaryCls = "rounded bg-black px-3 py-1.5 text-xs text-white disabled:opacity-50 dark:bg-white dark:text-black";

export default function ScenarioEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [notFound, setNotFound] = useState(false);

  async function refetch() {
    const res = await fetch(`/api/scenarios/${id}`);
    if (res.status === 404) {
      setNotFound(true);
      return;
    }
    setScenario(await res.json());
  }

  useEffect(() => {
    let ignore = false;
    fetch(`/api/scenarios/${id}`).then(async (res) => {
      if (ignore) return;
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      setScenario(await res.json());
    });
    return () => {
      ignore = true;
    };
  }, [id]);

  async function addLevel() {
    await fetch(`/api/scenarios/${id}/levels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Новый уровень", objective: "Новая цель", openingLine: "..." }),
    });
    await refetch();
  }

  if (notFound) return <main className="mx-auto max-w-3xl p-8">Сценарий не найден.</main>;
  if (!scenario) return <main className="mx-auto max-w-3xl p-8">Загрузка...</main>;

  return (
    <main className="mx-auto max-w-3xl p-8 pb-24">
      <a href="/admin" className="mb-4 inline-block text-sm text-black/60 hover:underline dark:text-white/60">
        ← К списку сценариев
      </a>

      <ScenarioSection scenario={scenario} onSaved={refetch} />

      <h2 className="mt-10 mb-3 text-lg font-semibold">Уровни</h2>
      <div className="flex flex-col gap-4">
        {scenario.levels.map((level, i) => (
          <LevelCard
            key={level.id}
            scenarioId={id}
            level={level}
            isFirst={i === 0}
            isLast={i === scenario.levels.length - 1}
            onChanged={refetch}
          />
        ))}
      </div>

      <button className={`${btnCls} mt-4`} onClick={addLevel}>
        + Добавить Level
      </button>
    </main>
  );
}

function ScenarioSection({ scenario, onSaved }: { scenario: Scenario; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(scenario.title);
  const [domain, setDomain] = useState(scenario.domain);
  const [playerRole, setPlayerRole] = useState(scenario.playerRole);
  const [situation, setSituation] = useState(scenario.situation);
  const [difficulty, setDifficulty] = useState(scenario.difficulty);
  const [successCriteria, setSuccessCriteria] = useState(scenario.successCriteria);
  const [isPublished, setIsPublished] = useState(scenario.isPublished);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/scenarios/${scenario.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, domain, playerRole, situation, difficulty, successCriteria, isPublished }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error);
      return;
    }
    await onSaved();
  }

  return (
    <section className="rounded border border-black/10 p-4 dark:border-white/10">
      <h2 className="mb-3 text-lg font-semibold">Сценарий</h2>
      <div className="flex flex-col gap-3">
        <div>
          <label className={labelCls}>title</label>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>domain</label>
          <input className={inputCls} value={domain} onChange={(e) => setDomain(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>playerRole — кто игрок в этом сценарии (виден на экране контекста)</label>
          <input className={inputCls} value={playerRole} onChange={(e) => setPlayerRole(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>situation — исходная ситуация (виден на экране контекста)</label>
          <textarea className={inputCls} rows={3} value={situation} onChange={(e) => setSituation(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <div>
            <label className={labelCls}>difficulty</label>
            <select
              className={inputCls}
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Scenario["difficulty"])}
            >
              <option value="EASY">EASY</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HARD">HARD</option>
            </select>
          </div>
          <label className="mt-5 flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
            опубликован
          </label>
        </div>
        <div>
          <label className={labelCls}>successCriteria</label>
          <textarea
            className={inputCls}
            rows={2}
            value={successCriteria}
            onChange={(e) => setSuccessCriteria(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className={`${btnPrimaryCls} self-start`} onClick={save} disabled={saving}>
          {saving ? "Сохранение..." : "Сохранить сценарий"}
        </button>
      </div>
    </section>
  );
}

function LevelCard({
  scenarioId,
  level,
  isFirst,
  isLast,
  onChanged,
}: {
  scenarioId: string;
  level: Level;
  isFirst: boolean;
  isLast: boolean;
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState(level.title);
  const [opponentRole, setOpponentRole] = useState(level.opponentRole);
  const [opponentTone, setOpponentTone] = useState(level.opponentTone);
  const [opponentGoals, setOpponentGoals] = useState(level.opponentGoals);
  const [objective, setObjective] = useState(level.objective);
  const [openingLine, setOpeningLine] = useState(level.openingLine);
  const [maxRounds, setMaxRounds] = useState(level.maxRounds);
  const [advanceThreshold, setAdvanceThreshold] = useState(level.advanceThreshold);
  const [failThreshold, setFailThreshold] = useState(level.failThreshold);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const base = `/api/scenarios/${scenarioId}/levels/${level.id}`;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(base, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        opponentRole,
        opponentTone,
        opponentGoals,
        objective,
        openingLine,
        maxRounds,
        advanceThreshold,
        failThreshold,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error);
      return;
    }
    await onChanged();
  }

  async function remove() {
    if (!confirm(`Удалить уровень "${title}" вместе со всеми его стадиями?`)) return;
    await fetch(base, { method: "DELETE" });
    await onChanged();
  }

  async function move(direction: "up" | "down") {
    await fetch(`${base}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    await onChanged();
  }

  async function addStage() {
    await fetch(`${base}/stages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "CONTACT" }),
    });
    await onChanged();
  }

  return (
    <div className="rounded border border-black/10 p-4 dark:border-white/10">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-black/60 dark:text-white/60">
          Level {level.order}
        </span>
        <div className="flex gap-1">
          <button className={btnCls} onClick={() => move("up")} disabled={isFirst} title="Переместить вверх">
            ↑
          </button>
          <button className={btnCls} onClick={() => move("down")} disabled={isLast} title="Переместить вниз">
            ↓
          </button>
          <button className={btnDangerCls} onClick={remove}>
            Удалить
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>title</label>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>opponentRole</label>
          <input className={inputCls} value={opponentRole} onChange={(e) => setOpponentRole(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>opponentTone</label>
          <input className={inputCls} value={opponentTone} onChange={(e) => setOpponentTone(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>objective</label>
          <input className={inputCls} value={objective} onChange={(e) => setObjective(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>opponentGoals</label>
          <textarea className={inputCls} rows={2} value={opponentGoals} onChange={(e) => setOpponentGoals(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>openingLine</label>
          <textarea className={inputCls} rows={2} value={openingLine} onChange={(e) => setOpeningLine(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>maxRounds</label>
          <input
            type="number"
            className={inputCls}
            value={maxRounds}
            onChange={(e) => setMaxRounds(Number(e.target.value))}
          />
        </div>
        <div>
          <label className={labelCls}>advanceThreshold</label>
          <input
            type="number"
            className={inputCls}
            value={advanceThreshold}
            onChange={(e) => setAdvanceThreshold(Number(e.target.value))}
          />
        </div>
        <div>
          <label className={labelCls}>failThreshold</label>
          <input
            type="number"
            className={inputCls}
            value={failThreshold}
            onChange={(e) => setFailThreshold(Number(e.target.value))}
          />
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button className={`${btnPrimaryCls} mt-3`} onClick={save} disabled={saving}>
        {saving ? "Сохранение..." : "Сохранить уровень"}
      </button>

      <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
        <h3 className="mb-2 text-sm font-medium text-black/60 dark:text-white/60">Stages</h3>
        <div className="flex flex-col gap-2">
          {level.stages.map((stage, i) => (
            <StageRow
              key={stage.id}
              scenarioId={scenarioId}
              levelId={level.id}
              stage={stage}
              isFirst={i === 0}
              isLast={i === level.stages.length - 1}
              onChanged={onChanged}
            />
          ))}
        </div>
        <button className={`${btnCls} mt-2`} onClick={addStage}>
          + Добавить Stage
        </button>
      </div>
    </div>
  );
}

function StageRow({
  scenarioId,
  levelId,
  stage,
  isFirst,
  isLast,
  onChanged,
}: {
  scenarioId: string;
  levelId: string;
  stage: Stage;
  isFirst: boolean;
  isLast: boolean;
  onChanged: () => Promise<void>;
}) {
  const [type, setType] = useState<StageType>(stage.type);
  const [title, setTitle] = useState(stage.title ?? "");
  const [description, setDescription] = useState(stage.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const base = `/api/scenarios/${scenarioId}/levels/${levelId}/stages/${stage.id}`;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(base, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, title, description }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error);
      return;
    }
    await onChanged();
  }

  async function remove() {
    if (!confirm(`Удалить стадию "${type}"?`)) return;
    await fetch(base, { method: "DELETE" });
    await onChanged();
  }

  async function move(direction: "up" | "down") {
    await fetch(`${base}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    await onChanged();
  }

  return (
    <div className="rounded border border-black/10 p-3 dark:border-white/10">
      {stage.branchKey && (
        <div className="mb-2 flex items-center gap-1.5 text-xs">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Развилка · order={stage.order} · вариант «{stage.branchKey === "soft" ? "мягкий" : "жёсткий"}»
          </span>
          <span className="text-black/40 dark:text-white/40">
            движок выбирает автоматически по ходу игры, order у обоих вариантов совпадает намеренно
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className={labelCls}>type</label>
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as StageType)}>
            {STAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[10rem] flex-1">
          <label className={labelCls}>title</label>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="min-w-[12rem] flex-1">
          <label className={labelCls}>description</label>
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="flex gap-1">
          <button
            className={btnCls}
            onClick={() => move("up")}
            disabled={isFirst || !!stage.branchKey}
            title={stage.branchKey ? "Стадии развилки нельзя переставлять — это сломает пару" : "Вверх"}
          >
            ↑
          </button>
          <button
            className={btnCls}
            onClick={() => move("down")}
            disabled={isLast || !!stage.branchKey}
            title={stage.branchKey ? "Стадии развилки нельзя переставлять — это сломает пару" : "Вниз"}
          >
            ↓
          </button>
          <button className={btnPrimaryCls} onClick={save} disabled={saving}>
            {saving ? "..." : "Сохранить"}
          </button>
          <button className={btnDangerCls} onClick={remove}>
            Удалить
          </button>
        </div>
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
