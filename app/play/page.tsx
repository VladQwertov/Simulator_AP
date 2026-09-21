"use client";

import { useState } from "react";

type Message = { role: "USER" | "OPPONENT"; text: string };
type Feedback = {
  summary: string;
  strengths: string;
  improvements: string;
  overallScore: number;
};

export default function PlayPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function start() {
    setLoading(true);
    const res = await fetch("/api/sessions", { method: "POST" });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      alert(data.error);
      return;
    }
    setSessionId(data.sessionId);
    setMessages([{ role: "OPPONENT", text: data.openingLine }]);
  }

  async function sendTurn() {
    if (!input.trim() || !sessionId) return;
    const userMessage = input;
    setMessages((m) => [...m, { role: "USER", text: userMessage }]);
    setInput("");
    setLoading(true);

    const res = await fetch(`/api/sessions/${sessionId}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMessage }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      alert(data.error);
      return;
    }

    setMessages((m) => [...m, { role: "OPPONENT", text: data.opponentReply }]);

    if (data.isEnding) {
      setFinished(true);
      const fbRes = await fetch(`/api/sessions/${sessionId}/feedback`);
      const fbData = await fbRes.json();
      setFeedback(fbData);
    }
  }

  if (!sessionId) {
    return (
      <main style={{ padding: 40 }}>
        <h1>Арена переговоров</h1>
        <button onClick={start} disabled={loading}>
          {loading ? "Загрузка..." : "Начать переговоры"}
        </button>
      </main>
    );
  }

  return (
    <main style={{ padding: 40, maxWidth: 600 }}>
      <h1>Арена переговоров</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ textAlign: m.role === "USER" ? "right" : "left" }}>
            <b>{m.role === "USER" ? "Вы" : "Оппонент"}:</b> {m.text}
          </div>
        ))}
      </div>

      {!finished && (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendTurn()}
            style={{ flex: 1, padding: 8 }}
            placeholder="Твоя реплика..."
            disabled={loading}
          />
          <button onClick={sendTurn} disabled={loading}>
            {loading ? "..." : "Отправить"}
          </button>
        </div>
      )}

      {finished && feedback && (
        <div style={{ marginTop: 24, padding: 16, background: "#f4f4f4" }}>
          <h2>Итог: {feedback.overallScore}/100</h2>
          <p><b>Резюме:</b> {feedback.summary}</p>
          <p><b>Сильные стороны:</b> {feedback.strengths}</p>
          <p><b>Над чем работать:</b> {feedback.improvements}</p>
        </div>
      )}
    </main>
  );
}
