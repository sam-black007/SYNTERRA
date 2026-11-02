import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  Minimize2,
  Trash2,
  Thermometer,
  Droplets,
  Sprout,
  ChevronRight
} from 'lucide-react';

// Lightweight Markdown Formatter for Agronomic Advice
function MarkdownText({ content }) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements = [];
  let currentList = [];
  let listType = null; // 'ul' | 'ol'

  const flushList = () => {
    if (currentList.length > 0) {
      if (listType === 'ul') {
        elements.push(
          <ul key={`ul-${elements.length}`} className="my-1.5 space-y-1 pl-4 list-disc marker:text-emerald-400 text-xs">
            {currentList.map((item, idx) => (
              <li key={idx} className="leading-relaxed">{item}</li>
            ))}
          </ul>
        );
      } else if (listType === 'ol') {
        elements.push(
          <ol key={`ol-${elements.length}`} className="my-1.5 space-y-1 pl-4 list-decimal marker:text-teal-400 text-xs">
            {currentList.map((item, idx) => (
              <li key={idx} className="leading-relaxed">{item}</li>
            ))}
          </ol>
        );
      }
      currentList = [];
      listType = null;
    }
  };

  const renderInline = (text) => {
    const parts = [];
    let keyIdx = 0;
    const inlineRegex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
    let match;
    let lastIndex = 0;

    while ((match = inlineRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        parts.push(
          <strong key={keyIdx++} className="font-bold text-white">
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith('`') && token.endsWith('`')) {
        parts.push(
          <code key={keyIdx++} className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-teal-300 font-mono text-[11px]">
            {token.slice(1, -1)}
          </code>
        );
      } else if (token.startsWith('*') && token.endsWith('*')) {
        parts.push(
          <em key={keyIdx++} className="italic text-slate-300">
            {token.slice(1, -1)}
          </em>
        );
      }
      lastIndex = inlineRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Heading 3: ###
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h4 key={`h3-${i}`} className="font-bold text-emerald-300 text-sm mt-2 mb-1 flex items-center gap-1.5">
          {renderInline(trimmed.replace(/^###\s+/, ''))}
        </h4>
      );
      continue;
    }

    // Heading 4: ####
    if (trimmed.startsWith('#### ')) {
      flushList();
      elements.push(
        <h5 key={`h4-${i}`} className="font-semibold text-teal-200 text-xs mt-2 mb-0.5 tracking-wide uppercase">
          {renderInline(trimmed.replace(/^####\s+/, ''))}
        </h5>
      );
      continue;
    }

    // Bullet list: - or *
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      currentList.push(renderInline(trimmed.replace(/^[-*]\s+/, '')));
      continue;
    }

    // Numbered list: 1. or 2.
    if (/^\d+\.\s+/.test(trimmed)) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      currentList.push(renderInline(trimmed.replace(/^\d+\.\s+/, '')));
      continue;
    }

    // Standard paragraph line
    flushList();
    elements.push(
      <p key={`p-${i}`} className="my-1 text-xs leading-relaxed text-slate-200">
        {renderInline(trimmed)}
      </p>
    );
  }

  flushList();
  return <div className="space-y-0.5">{elements}</div>;
}

// Error Boundary Wrapper to Prevent Any Child Failure from Impacting Dashboard
class ChatbotErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, errorInfo) {
    console.warn('Chatbot widget error suppressed:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

function ChatbotWidgetContent({ latestTelemetry, liveTelemetry, weatherData, latestDiagnosis }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 'init-1',
      sender: 'bot',
      text: "### 🌿 Welcome to Synterra Botanical Copilot\nI am your AI Senior Agronomist (TerraAI), synced to your live canopy telemetry, plant pathology diagnostics, and hyper-local 5-day weather models.\n\nHow can I assist your crop management today?",
      timestamp: 'Live',
      source: 'gemini_pro_agronomist'
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([
    "Why is the pathogen incubation risk elevated?",
    "Should I irrigate given today's rain probability?",
    "How should I treat Early Blight organic vs chemical?",
    "Analyze current canopy VPD and transpiration rate."
  ]);
  const [telemetrySnapshot, setTelemetrySnapshot] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Hoisted Fetch Suggestions
  async function fetchSuggestions() {
    try {
      const res = await fetch('/api/chat/suggestions');
      const data = await res.json();
      if (data.success) {
        if (data.suggestions && data.suggestions.length > 0) {
          setSuggestions(data.suggestions);
        }
        if (data.context) {
          setTelemetrySnapshot(data.context);
        }
      }
    } catch (e) {
      console.warn('Failed to load chat suggestions:', e);
    }
  }

  // Fetch contextual suggestions on mount
  useEffect(() => {
    fetchSuggestions();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isLoading]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const handleSend = async (messageText = null) => {
    const textToSend = (messageText || input).trim();
    if (!textToSend || isLoading) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMessage]);
    if (!messageText) setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          history: messages.slice(-6).map((m) => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text
          }))
        })
      });

      const data = await res.json();
      if (data.success) {
        const botMessage = {
          id: `bot-${Date.now()}`,
          sender: 'bot',
          text: data.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          source: data.source
        };
        setMessages((prev) => [...prev, botMessage]);
        if (data.context_snapshot) {
          setTelemetrySnapshot(data.context_snapshot);
        }
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-err-${Date.now()}`,
            sender: 'bot',
            text: `⚠️ **Consultation Notice:** ${data.reply || 'Could not process query. Please try again.'}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-err-${Date.now()}`,
          sender: 'bot',
          text: "⚠️ **Connection Notice:** Unable to reach the SYNTERRA Agronomy Engine. Ensure the backend daemon is running.",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsLoading(false);
      fetchSuggestions();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: `init-${Date.now()}`,
        sender: 'bot',
        text: "### 🌿 Conversation Reset\nAgronomic session cleared. I am ready with live canopy telemetry and 5-day predictive forecasts.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        source: 'gemini_pro_agronomist'
      }
    ]);
  };

  // Derive display values safely from either latestTelemetry or fallback snapshot
  const telem = latestTelemetry || liveTelemetry;
  const curTemp = telem?.temperature_c ?? telem?.temperature ?? telemetrySnapshot?.telemetry?.temperature_c ?? 22.4;
  const curRH = telem?.humidity_pct ?? telem?.humidity ?? telemetrySnapshot?.telemetry?.humidity_pct ?? 68.0;
  const curSoil = telem?.soil_moisture_pct ?? telem?.soilMoisture ?? telemetrySnapshot?.telemetry?.soil_moisture_pct ?? 58.0;
  const curRisk = weatherData?.overall_risk ?? telemetrySnapshot?.weather?.overall_risk ?? 'MODERATE';

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {/* ================================================================ */}
      {/* FLOATING ACTION BUTTON (Minimized State)                         */}
      {/* ================================================================ */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="group relative flex items-center gap-3 px-4 py-3 rounded-full bg-gradient-to-r from-teal-600 via-emerald-600 to-teal-500 text-white shadow-2xl shadow-emerald-950/60 hover:shadow-emerald-500/30 hover:scale-105 active:scale-95 transition-all duration-300 border border-emerald-400/40 cursor-pointer"
          aria-label="Open AI Agronomist Copilot"
        >
          <div className="relative">
            <div className="p-1.5 rounded-full bg-black/25">
              <Bot className="w-5 h-5 text-emerald-100" />
            </div>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-teal-300 rounded-full animate-ping opacity-75" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-teal-400 rounded-full border-2 border-slate-900" />
          </div>

          <div className="text-left hidden sm:block">
            <p className="text-xs font-bold tracking-wide leading-tight flex items-center gap-1.5">
              <span>TerraAI Copilot</span>
              <Sparkles className="w-3 h-3 text-amber-300 animate-pulse" />
            </p>
            <p className="text-[10px] text-emerald-100/90 font-medium leading-tight">
              AI Senior Agronomist
            </p>
          </div>

          {curRisk === 'HIGH' && (
            <span className="ml-1 px-1.5 py-0.5 rounded-md bg-rose-500/90 text-[10px] font-black uppercase text-white tracking-wider border border-rose-300/40">
              Risk Alert
            </span>
          )}
        </button>
      )}

      {/* ================================================================ */}
      {/* EXPANDED CHAT DRAWER / WINDOW                                    */}
      {/* ================================================================ */}
      {isOpen && (
        <div className="w-[92vw] sm:w-[440px] h-[600px] max-h-[85vh] flex flex-col bg-[#0b121f]/95 backdrop-blur-2xl border border-slate-800 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden animate-in fade-in zoom-in-95 duration-200 ring-1 ring-emerald-500/20">
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-r from-slate-900 via-slate-900/90 to-[#0a1824] border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="relative p-2 rounded-xl bg-gradient-to-br from-teal-500/20 to-emerald-500/20 border border-teal-500/40 text-teal-300">
                <Bot className="w-4 h-4" />
                <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-400 ring-1 ring-slate-900" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-bold text-white text-xs tracking-tight">Synterra Botanical Copilot</h3>
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-teal-500/10 text-teal-300 border border-teal-500/30">
                    AI Agronomist
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Live Telemetry & Disease Vector Synced</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleClearChat}
                title="Clear Chat History"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                title="Minimize Copilot"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Live Telemetry Context Ticker */}
          <div className="px-3 py-1.5 bg-slate-950/60 border-b border-slate-800/60 flex items-center justify-between text-[10px] overflow-x-auto gap-2 no-scrollbar">
            <span className="flex items-center gap-1 text-slate-300 shrink-0">
              <Thermometer className="w-3 h-3 text-rose-400" />
              <span>{typeof curTemp === 'number' ? curTemp.toFixed(1) : curTemp}°C</span>
            </span>
            <span className="flex items-center gap-1 text-slate-300 shrink-0">
              <Droplets className="w-3 h-3 text-cyan-400" />
              <span>RH {typeof curRH === 'number' ? curRH.toFixed(0) : curRH}%</span>
            </span>
            <span className="flex items-center gap-1 text-slate-300 shrink-0">
              <Sprout className="w-3 h-3 text-emerald-400" />
              <span>Soil {typeof curSoil === 'number' ? curSoil.toFixed(0) : curSoil}%</span>
            </span>
            <span className={`px-1.5 py-0.2 rounded font-bold uppercase text-[9px] shrink-0 border ${
              curRisk === 'HIGH'
                ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                : curRisk === 'MODERATE'
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            }`}>
              {curRisk} Spore Risk
            </span>
          </div>

          {/* Quick Suggestion Pills */}
          <div className="px-3 py-2 bg-slate-900/40 border-b border-slate-800/50 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {suggestions.map((sug, i) => (
              <button
                key={i}
                onClick={() => handleSend(sug)}
                className="text-[11px] px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 shrink-0 transition flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <span>{sug}</span>
                <ChevronRight className="w-2.5 h-2.5 text-teal-400" />
              </button>
            ))}
          </div>

          {/* Message Stream */}
          <div className="flex-1 p-3.5 overflow-y-auto space-y-3 text-xs">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] p-3 rounded-2xl ${
                    msg.sender === 'user'
                      ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-br-none shadow-md shadow-emerald-950/40'
                      : 'bg-slate-900/90 border border-slate-800 text-slate-200 rounded-bl-none shadow-lg'
                  }`}
                >
                  {msg.sender === 'bot' ? (
                    <MarkdownText content={msg.text} />
                  ) : (
                    <p className="leading-relaxed text-xs">{msg.text}</p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mt-1 px-1 text-[9px] text-slate-500">
                  <span>{msg.timestamp}</span>
                  {msg.source && (
                    <>
                      <span>•</span>
                      <span className="text-teal-400 font-mono">
                        {msg.source.includes('gemini') ? 'Gemini 3.5 Flash' : 'Botanical Core'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}

            {/* Typing Indicator */}
            {isLoading && (
              <div className="flex flex-col items-start">
                <div className="p-3 rounded-2xl rounded-bl-none bg-slate-900/90 border border-slate-800 text-slate-400 flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-[11px] text-slate-400 italic">TerraAI evaluating microclimate & pathology vector...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <div className="p-2.5 bg-slate-950 border-t border-slate-800">
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 focus-within:border-teal-500/60 focus-within:ring-1 focus-within:ring-teal-500/40 transition">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about blight treatments, VPD, irrigation, nutrients..."
                className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
                disabled={isLoading}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading}
                className="p-1.5 rounded-lg bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:hover:bg-teal-500 text-slate-950 transition font-bold cursor-pointer"
                title="Send to Agronomist"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-1.5 px-1 text-[9px] text-slate-500">
              <span>SYNTERRA Precision Botanical Copilot v2.4</span>
              <span className="text-emerald-400/80">Press Enter ↵ to send</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChatbotWidget(props) {
  return (
    <ChatbotErrorBoundary>
      <ChatbotWidgetContent {...props} />
    </ChatbotErrorBoundary>
  );
}
