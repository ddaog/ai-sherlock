"use client";

import { useState, useRef, useEffect } from "react";
import type { Hypothesis } from "@/lib/hypothesesSimple";
import { VICTIM_NAME } from "@/data/case.display";

const SESSION_STORAGE_KEY = "case_session_state_v9";
const MAX_HYPOTHESES = 5;
const MAX_HINTS = 3;

const SLASH_COMMANDS = [
  { cmd: "/가설", desc: "가설 기록" },
  { cmd: "/추리", desc: "결론 제출" },
  { cmd: "/힌트", desc: "힌트 요청 (3회 제한)" },
] as const;

function highlightVictim(text: string, victim: string) {
  if (!victim) return text;
  const parts = text.split(new RegExp(`(${victim})`, "g"));
  return parts.map((part, i) =>
    part === victim ? (
      <span key={i} className="text-archive-accent font-semibold">
        {part}
      </span>
    ) : (
      part
    )
  );
}

function Typewriter({
  text,
  onType,
  victim,
}: {
  text: string;
  onType?: () => void;
  victim?: string;
}) {
  const [displayedText, setDisplayedText] = useState("");
  const onTypeRef = useRef(onType);

  useEffect(() => {
    onTypeRef.current = onType;
  }, [onType]);

  useEffect(() => {
    let index = 0;
    setDisplayedText("");
    const interval = setInterval(() => {
      setDisplayedText(text.slice(0, index + 1));
      index++;
      if (onTypeRef.current) onTypeRef.current();
      if (index >= text.length) clearInterval(interval);
    }, 20);
    return () => clearInterval(interval);
  }, [text]);

  return (
    <>
      {victim ? highlightVictim(displayedText, victim) : displayedText}
      {displayedText.length < text.length && (
        <span className="inline-block w-2 h-4 bg-archive-accent ml-1 -mb-0.5 align-baseline animate-pulse"></span>
      )}
    </>
  );
}

interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  embeddingTokens: number;
  costUsd: number;
  costKrw: number;
}

interface Message {
  role: "user" | "assistant";
  content?: string;
  response?: string;
  badge?: { title: string; condition: string };
  sources?: string[];
  suggestions?: string[];
  usage?: Usage;
}

interface GameSessionState {
  solved: boolean;
  solvedAt?: string;
  seenRecordIds: string[];
  triggeredBadges: string[];
  messages?: Message[];
  hypotheses?: Hypothesis[];
  hintCount?: number;
}

function loadSessionState(): Partial<GameSessionState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<GameSessionState>;
  } catch {
    return null;
  }
}

function saveSessionState(state: Partial<GameSessionState>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [cumulativeCostKrw, setCumulativeCostKrw] = useState(0);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [seenRecordIds, setSeenRecordIds] = useState<string[]>([]);
  const [triggeredBadges, setTriggeredBadges] = useState<string[]>([]);
  const [solved, setSolved] = useState(false);
  const [pendingHypothesisReplace, setPendingHypothesisReplace] = useState<
    { newText: string; matchedHypothesisId: string } | undefined
  >(undefined);
  const [pendingReset, setPendingReset] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [hintCount, setHintCount] = useState(0);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = loadSessionState();
    if (saved) {
      if (saved.solved === true) setSolved(true);
      if (saved.seenRecordIds) setSeenRecordIds(saved.seenRecordIds);
      if (saved.triggeredBadges) setTriggeredBadges(saved.triggeredBadges);
      if (Array.isArray(saved.messages) && saved.messages.length > 0) setMessages(saved.messages);
      if (Array.isArray(saved.hypotheses)) setHypotheses(saved.hypotheses.slice(0, MAX_HYPOTHESES));
      if (typeof saved.hintCount === "number") setHintCount(saved.hintCount);
    }
  }, []);

  useEffect(() => {
    saveSessionState({
      solved,
      solvedAt: solved ? new Date().toISOString() : undefined,
      seenRecordIds,
      triggeredBadges,
      messages,
      hypotheses,
      hintCount,
    });
  }, [solved, seenRecordIds, triggeredBadges, messages, hypotheses, hintCount]);

  const handleRestart = () => {
    saveSessionState({
      solved: false,
      seenRecordIds: [],
      triggeredBadges: [],
      messages: [],
      hypotheses: [],
      hintCount: 0,
    });
    setSolved(false);
    setMessages([]);
    setHypotheses([]);
    setSeenRecordIds([]);
    setTriggeredBadges([]);
    setHintCount(0);
    setInput("");
    setPendingHypothesisReplace(undefined);
    setPendingReset(false);
    setShowCommandPalette(false);
    inputRef.current?.focus();
  };

  const lastSuggestions =
    [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.suggestions?.length)
      ?.suggestions ?? [];

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const lastAssistantIsResetConfirm = (() => {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    return last?.response?.includes("초기화를 진행할까요") ?? false;
  })();

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading || solved) return;

    const isY = /^(y|yes|예|네|ㅇ)$/i.test(trimmed);
    const isN = /^(n|no|아니오|아니요|ㄴ)$/i.test(trimmed);
    const awaitingResetConfirm = pendingReset || (lastAssistantIsResetConfirm && (isY || isN));

    // 가설 덮어쓰기 확인 중이면 Y/N을 API로 보냄. 초기화 확인과 구분.
    if (awaitingResetConfirm && !pendingHypothesisReplace && (isY || isN)) {
      if (isY) {
        handleRestart();
      } else {
        setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
        setMessages((prev) => [...prev, { role: "assistant", response: "취소되었습니다." }]);
      }
      setPendingReset(false);
      setInput("");
      return;
    }

    if (/^\/초기화$/i.test(trimmed)) {
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", response: "초기화를 진행할까요? localStorage 데이터가 삭제됩니다. (Y: 실행, N: 취소)" },
      ]);
      setPendingReset(true);
      setInput("");
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setShowCommandPalette(false);
    setInput("");
    setLoading(true);

    try {
      const history = messages
        .filter((m) => m.content)
        .map((m) => ({
          role: m.role,
          content:
            m.role === "user"
              ? m.content!
              : [
                m.response || "",
                m.sources?.length ? "SOURCES: " + m.sources.join(", ") : "",
                m.suggestions?.length ? "SUGGESTION: " + m.suggestions.join("; ") : "",
              ]
                .filter(Boolean)
                .join("\n"),
        }));

      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          history,
          hypotheses,
          seenRecordIds,
          triggeredBadges,
          sessionState: {
            solved,
            solvedAt: solved ? new Date().toISOString() : undefined,
            hintCount,
            ...(pendingHypothesisReplace && { pendingHypothesisReplace }),
          },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (Array.isArray(data.hypotheses)) setHypotheses(data.hypotheses.slice(0, MAX_HYPOTHESES));
        if (Array.isArray(data.seenRecordIds)) setSeenRecordIds(data.seenRecordIds);
        if (Array.isArray(data.triggeredBadges)) setTriggeredBadges(data.triggeredBadges);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            response: data.error || "오류가 발생했습니다.",
            suggestions: [
              "7월 18일 당시 별관 출입 기록은?",
              "피해자 김도윤과 관련된 인물은?",
            ],
          },
        ]);
        setSuggestionIndex(-1);
        return;
      }

      if (Array.isArray(data.hypotheses)) setHypotheses(data.hypotheses.slice(0, MAX_HYPOTHESES));
      if (Array.isArray(data.seenRecordIds)) setSeenRecordIds(data.seenRecordIds);
      if (Array.isArray(data.triggeredBadges)) setTriggeredBadges(data.triggeredBadges);
      if (data.solved === true) setSolved(true);
      setPendingHypothesisReplace(data.sessionState?.pendingHypothesisReplace);
      if (typeof data.sessionState?.hintCount === "number") setHintCount(data.sessionState.hintCount);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          response: data.response,
          badge: data.badge,
          sources: data.sources || [],
          suggestions: data.suggestions || [],
          usage: data.usage,
        },
      ]);
      setSuggestionIndex(-1);
      if (data.usage?.costKrw) {
        setCumulativeCostKrw((prev) => prev + data.usage.costKrw);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          response: "연결 오류가 발생했습니다. 다시 시도해 주세요.",
          suggestions: [],
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleSelectCommand = (cmd: string) => {
    setInput(cmd + " ");
    setShowCommandPalette(false);
    setCommandPaletteIndex(0);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // "/" 입력 시 상위 핸들러(예: Cursor 슬래시 명령)가 가로채지 않도록 전파 차단
    if (e.key === "/") {
      e.stopPropagation();
    }
    if (showCommandPalette) {
      if (e.key === "Escape") {
        setShowCommandPalette(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCommandPaletteIndex((i) => (i + 1) % SLASH_COMMANDS.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCommandPaletteIndex((i) => (i - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSelectCommand(SLASH_COMMANDS[commandPaletteIndex].cmd);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      // IME 조합 중(한글 등)에는 Enter를 가로채지 않음
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      handleSubmit();
      return;
    }
    if (e.key === "ArrowUp" && lastSuggestions.length > 0 && !showCommandPalette) {
      e.preventDefault();
      const next =
        suggestionIndex <= 0 ? lastSuggestions.length - 1 : suggestionIndex - 1;
      setSuggestionIndex(next);
      setInput(lastSuggestions[next]);
      return;
    }
    if (e.key === "ArrowDown" && lastSuggestions.length > 0 && !showCommandPalette) {
      e.preventDefault();
      const next =
        suggestionIndex >= lastSuggestions.length - 1 ? 0 : suggestionIndex + 1;
      setSuggestionIndex(next);
      setInput(lastSuggestions[next]);
      return;
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-archive-bg relative text-archive-text font-serif scanlines overflow-hidden">
      <div className="max-w-3xl w-full mx-auto flex flex-col h-full bg-archive-bg/95 shadow-2xl relative z-10 border-x border-archive-border-subtle">
        <header className="shrink-0 py-2.5 px-4 border-b border-archive-border flex items-center justify-between gap-4 font-mono z-10 relative bg-black/70 backdrop-blur-md">
          <h1 className="text-base font-bold text-archive-text flex items-center gap-2 tracking-wide">
            <span className="w-1.5 h-3 bg-archive-accent caret-blink inline-block"></span>
            사건 기록 시스템 <span className="text-archive-accent opacity-80 text-xs">v1.4</span>
          </h1>
          <p className="text-archive-muted-deep text-[10px] shrink-0 tracking-widest uppercase">
            누적 비용: ₩{cumulativeCostKrw.toFixed(3)}
          </p>
        </header>

        {hypotheses.length > 0 && (
          <div className="shrink-0 px-4 py-2 bg-archive-surface/60 border-b border-archive-border text-xs backdrop-blur-sm z-10 relative">
            <p className="text-archive-accent mb-1 font-mono text-[10px] tracking-widest font-bold uppercase">
              [CURRENT HYPOTHESES]
            </p>
            <ul className="space-y-1 text-archive-text font-serif leading-snug">
              {hypotheses.map((h) => (
                <li key={h.id} className="text-[13px] flex items-start gap-1.5">
                  <span className="text-archive-muted shrink-0 mt-0.5">-</span>
                  <span>
                    <span className="font-bold mr-1">{h.id}</span> {highlightVictim(h.text, VICTIM_NAME)}
                    <span className="text-archive-muted-deep ml-1.5 text-[11px] font-mono tracking-tight">
                      (지지 {h.support} / 충돌 {h.conflict})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="shrink-0 px-4 py-3 bg-archive-surface/30 border-b border-archive-border text-[13px] text-archive-muted space-y-2 z-10 relative font-serif">
          <p className="leading-snug">
            당신은 외부 조사관입니다. 시스템은 사건 기록을 보관하고 있으며, 당신의
            질문에 따라 기록 일부를 열람할 수 있습니다. <span className="text-archive-accent opacity-90 ml-1">본 시스템은 범인을 판정하지 않습니다. 기록을 연결해 전말을 재구성하세요.</span>
          </p>
          <div className="pt-2 mt-2 border-t border-archive-border border-dashed text-archive-text bg-black/40 px-3 py-2 rounded-sm shadow-inner text-[12px]">
            <p className="font-bold mb-1.5 font-mono text-archive-accent text-[10px] tracking-widest uppercase">[SYNOPSIS]</p>
            <p className="leading-normal">
              {highlightVictim(
                "7월 18일 밤, 회사 별관 3층에서 CFO 김도윤이 의식불명 상태로 발견되었다. 외부 침입 흔적은 없으며, 당시 출입 인원은 총 7명. (다음날 내부 감사 예정)",
                VICTIM_NAME
              )}
            </p>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-8 z-10 relative scroll-smooth">
          {messages.length === 0 && (
            <div className="text-archive-muted text-[13px] font-serif space-y-3 pb-6">
              <p className="font-mono text-archive-accent text-[11px] tracking-widest uppercase mb-4">[플레이 방법]</p>
              <p><span className="font-mono text-archive-accent">/가설</span> 가설 기록. 예: /가설 박지훈이 범인인 것 같아</p>
              <p><span className="font-mono text-archive-accent">/추리</span> 결론 제출. 예: /추리 박지훈이 비자금 때문에 약물로 범행했다</p>
              <p><span className="font-mono text-archive-accent">/힌트</span> 적당한 힌트 제공 (3회 제한)</p>
              <p><span className="font-mono text-archive-accent">/초기화</span> localStorage 삭제 후 게임 다시 시작 (Y/N 확인)</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex animate-fade-in ${msg.role === "user" ? "justify-end" : "justify-start"
                }`}
            >
              <div
                className={
                  msg.role === "user"
                    ? "max-w-[85%] rounded-md px-5 py-3 bg-archive-surface border border-archive-border shadow-lg shadow-black/60"
                    : "max-w-[95%] w-full"
                }
              >
                {msg.role === "user" ? (
                  <p className="text-[16px] text-archive-text font-serif leading-relaxed tracking-wide">
                    {highlightVictim(msg.content ?? "", VICTIM_NAME)}
                  </p>
                ) : (
                  <div className="space-y-5 text-[16px] font-serif">
                    {msg.response && (
                      <div className="text-archive-text leading-[1.8] whitespace-pre-wrap px-5 py-4 bg-black/40 border-l-2 border-archive-accent rounded-r-md shadow-md">
                        {i === messages.length - 1 && !loading ? (
                          <Typewriter
                            text={msg.response}
                            onType={() => logEndRef.current?.scrollIntoView({ behavior: "auto" })}
                            victim={VICTIM_NAME}
                          />
                        ) : (
                          highlightVictim(msg.response, VICTIM_NAME)
                        )}
                      </div>
                    )}
                    {msg.badge && (
                      <div className="px-5 py-3 mt-4 rounded-md bg-archive-accent/10 border border-archive-accent/30">
                        <p className="font-mono text-[13px] font-semibold text-archive-accent tracking-wider">
                          [업적] {msg.badge.title} : {highlightVictim(msg.badge.condition, VICTIM_NAME)}
                        </p>
                      </div>
                    )}
                    {msg.sources && msg.sources.length > 0 && (
                      <p className="text-archive-muted text-[13px] font-mono tracking-wide px-5">
                        <span className="text-archive-muted-deep uppercase tracking-widest text-[11px] mr-2">출처:</span>
                        {msg.sources.map((id) => `[${id}]`).join(", ")}
                      </p>
                    )}
                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="px-5 py-4 bg-archive-surface/40 rounded-md border border-archive-border-subtle mt-5 shadow-sm">
                        <p className="text-archive-muted-deep mb-3 text-[11px] font-mono tracking-widest uppercase">[SUGGESTED QUERIES]</p>
                        <ul className="list-disc list-inside text-archive-accent/90 space-y-2">
                          {msg.suggestions.map((s, j) => (
                            <li key={j} className="text-archive-text/90 text-[15px] pl-1">
                              {highlightVictim(s, VICTIM_NAME)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {msg.usage && (
                      <div className="px-5 mt-4">
                        <p className="text-archive-muted-deep text-[11px] pt-3 border-t border-archive-border-subtle font-mono text-right uppercase tracking-wider">
                          토큰: {msg.usage.totalTokens} (입력 {msg.usage.promptTokens} + 출력 {msg.usage.completionTokens} + 임베딩 {msg.usage.embeddingTokens}) · 비용: ₩{(msg.usage.costKrw ?? 0).toFixed(3)}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start animate-fade-in px-5 py-2">
              <p className="text-archive-accent/80 text-[13px] font-mono tracking-widest flex items-center gap-3 uppercase">
                <span className="w-1.5 h-3.5 bg-archive-accent caret-blink inline-block"></span> 기록 조회 중 ...
              </p>
            </div>
          )}
          <div ref={logEndRef} className="h-6" />
        </div>

        <div className="shrink-0 p-6 border-t border-archive-border bg-black/80 backdrop-blur-md z-10 relative">
          {solved ? (
            <div className="flex justify-center">
              <button
                onClick={handleRestart}
                className="px-12 py-3 rounded-sm bg-archive-accent text-white font-bold font-mono tracking-widest hover:opacity-90 transition-all border border-archive-accent shadow-md uppercase text-[14px]"
              >
                다시 시작
              </button>
            </div>
          ) : (
            <div className="flex gap-4">
              <div className="flex-1 relative">
                <div className="flex items-stretch rounded-sm border border-archive-border bg-black/60 focus-within:border-archive-accent focus-within:ring-1 focus-within:ring-archive-accent/50">
                <button
                  type="button"
                  onClick={() => {
                    setInput("/");
                    setShowCommandPalette(true);
                    setCommandPaletteIndex(0);
                    inputRef.current?.focus();
                  }}
                  className="shrink-0 px-3 text-archive-muted hover:text-archive-accent transition-colors font-mono text-lg"
                  title="명령어 목록"
                >
                  /
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    const v = e.target.value;
                    setInput(v);
                    setSuggestionIndex(-1);
                    setShowCommandPalette(v.startsWith("/"));
                    if (v.startsWith("/")) setCommandPaletteIndex(0);
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={() => {
                    if (input.startsWith("/")) setShowCommandPalette(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => setShowCommandPalette(false), 150);
                  }}
                  placeholder="질문해서 사건을 파악해보세요. '/'을 입력해 기능을 사용해보세요."
                  className="flex-1 min-h-[52px] max-h-32 px-3 py-3.5 bg-transparent text-archive-text placeholder-archive-muted-deep focus:outline-none resize-none text-[16px] font-serif transition-colors"
                  rows={1}
                  disabled={loading}
                />
                </div>
                {showCommandPalette && (
                  <div
                    ref={paletteRef}
                    className="absolute bottom-full left-0 mb-1 w-full rounded-sm border border-archive-border bg-archive-surface shadow-xl overflow-hidden z-20"
                  >
                  <p className="px-4 py-2 text-archive-muted-deep text-[11px] font-mono tracking-widest uppercase border-b border-archive-border">
                    명령어
                  </p>
                  {SLASH_COMMANDS.map(({ cmd, desc }, i) => (
                    <button
                      key={cmd}
                      type="button"
                      onClick={() => handleSelectCommand(cmd)}
                      className={`w-full px-4 py-2.5 text-left flex items-center gap-3 transition-colors ${
                        i === commandPaletteIndex
                          ? "bg-archive-accent/20 text-archive-accent"
                          : "text-archive-text hover:bg-archive-surface/80"
                      }`}
                    >
                      <span className="font-mono text-archive-accent">{cmd}</span>
                      <span className="text-sm text-archive-muted">{desc}</span>
                    </button>
                  ))}
                  </div>
                )}
              </div>
              <button
                onClick={handleSubmit}
                disabled={loading || !input.trim()}
                className="shrink-0 px-8 py-2 rounded-sm bg-archive-surface text-archive-text font-bold font-mono tracking-widest hover:bg-archive-accent hover:text-white hover:border-archive-accent disabled:opacity-50 disabled:cursor-not-allowed transition-all border border-archive-border-subtle shadow-md uppercase text-[13px]"
              >
                Submit
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
