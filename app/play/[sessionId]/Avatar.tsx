// app/play/[sessionId]/Avatar.tsx
// Аватар оппонента: три зацикленных видео одного и того же человека (нейтральное/довольное/
// скептичное) — отрендерены офлайн через Remotion (см. ../../../avatar-video) из тех же фото,
// что сгенерировал пользователь: Ken Burns zoom/pan запечён прямо в видеофайл, а не CSS —
// public/avatar/{neutral,positive,negative}.mp4. Настроение (mood) приходит от Engine
// (lib/engine/mood.ts) через API и переключается кроссфейдом; activity — локальное состояние
// страницы (idle/listening/speaking), ускоряет воспроизведение видео через playbackRate, чтобы
// не рендерить отдельный ролик под каждую комбинацию mood×activity.
"use client";

import { useEffect, useRef } from "react";
import type { OpponentMood } from "@/lib/engine";

export type AvatarActivity = "idle" | "listening" | "speaking";

const VIDEO_SRC: Record<OpponentMood, string> = {
  neutral: "/avatar/neutral.mp4",
  positive: "/avatar/positive.mp4",
  negative: "/avatar/negative.mp4",
};

const RING_CLASS: Record<OpponentMood, string> = {
  positive: "ring-green-500/50",
  neutral: "ring-primary/40",
  negative: "ring-red-500/50",
};

const MOOD_LABEL: Record<OpponentMood, string> = {
  positive: "Заинтересован",
  neutral: "Нейтрален",
  negative: "Насторожен",
};

const MOOD_BADGE_CLASS: Record<OpponentMood, string> = {
  positive: "bg-green-100 text-green-700",
  neutral: "bg-primary-soft text-primary",
  negative: "bg-red-100 text-red-700",
};

const MOODS: OpponentMood[] = ["neutral", "positive", "negative"];

// Во время "speaking" ускоряем то же самое видео вместо рендера отдельного ролика —
// разница в темпе движения достаточно заметна, чтобы читаться как "оживление".
const SPEAKING_PLAYBACK_RATE = 3;

function VideoLayer({ mood, layer, activity }: { mood: OpponentMood; layer: OpponentMood; activity: AvatarActivity }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = activity === "speaking" ? SPEAKING_PLAYBACK_RATE : 1;
  }, [activity]);

  return (
    <video
      ref={ref}
      src={VIDEO_SRC[layer]}
      autoPlay
      loop
      muted
      playsInline
      className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ease-out"
      style={{ opacity: mood === layer ? 1 : 0 }}
    />
  );
}

function VideoStack({ mood, activity, ringClass }: { mood: OpponentMood; activity: AvatarActivity; ringClass: string }) {
  return (
    <>
      {activity === "listening" && (
        <span className={`absolute inset-0 rounded-full ring-2 ${ringClass} animate-ping`} aria-hidden />
      )}
      {activity === "speaking" && (
        <>
          <span
            className={`absolute inset-0 rounded-full ring-2 ${ringClass}`}
            style={{ animation: "avatar-wave-ring 1.1s ease-out infinite" }}
            aria-hidden
          />
          <span
            className={`absolute inset-0 rounded-full ring-2 ${ringClass}`}
            style={{ animation: "avatar-wave-ring 1.1s ease-out infinite", animationDelay: "0.35s" }}
            aria-hidden
          />
        </>
      )}
      <div className={`relative h-full w-full overflow-hidden rounded-full bg-background-soft ring-2 ${ringClass} transition-colors duration-300`}>
        {MOODS.map((m) => (
          <VideoLayer key={m} mood={mood} layer={m} activity={activity} />
        ))}
      </div>
    </>
  );
}

export function OpponentAvatar({
  mood,
  activity,
  size = 88,
}: {
  mood: OpponentMood;
  activity: AvatarActivity;
  size?: number;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <VideoStack mood={mood} activity={activity} ringClass={RING_CLASS[mood]} />
    </div>
  );
}

// Карточка в духе hyperbound.ai: крупное видео на мягком градиенте, имя/роль и бейдж настроения —
// для мест с достаточным пространством (брифинг, шапка чата во время диалога).
export function OpponentCard({
  mood,
  activity,
  name,
  tone,
  size = 128,
}: {
  mood: OpponentMood;
  activity: AvatarActivity;
  name: string;
  tone?: string;
  size?: number;
}) {
  return (
    <div
      className="rounded-3xl p-6 text-center"
      style={{ background: "linear-gradient(160deg, var(--accent-blue), var(--accent-pink))" }}
    >
      <div className="relative mx-auto" style={{ width: size, height: size }}>
        <VideoStack mood={mood} activity={activity} ringClass={RING_CLASS[mood]} />
      </div>
      <div className="mt-4 flex items-center justify-center gap-2">
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold text-foreground">AI</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${MOOD_BADGE_CLASS[mood]}`}>
          {MOOD_LABEL[mood]}
        </span>
      </div>
      <div className="mt-2 text-lg font-bold text-foreground">{name}</div>
      {tone && <div className="mt-0.5 text-sm text-muted">Тон: {tone}</div>}
    </div>
  );
}
