"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Send,
  Bot,
  User,
  Edit2,
  History,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Check,
  X,
  Settings,
  Filter,
  Zap,
  MessageCircle,
  ArrowRight,
} from "lucide-react";
import { LatestRecommendationPanel } from "../recommendations/LatestRecommendationPanel";
import { MessageContent } from "./MessageContent";
import { ResearchSourcesCollapsible } from "./ResearchSourcesCollapsible";
import { MessageToolExecutions } from "./MessageToolExecutions";
import { Toast } from "../ui/Toast";

interface MessageVersion {
  id: string;
  versionNumber: number;
  content: string;
  editedBy: string;
  reason?: string | null;
  createdAt: string;
}

interface Message {
  id: string;
  senderType: "USER" | "AI" | "SYSTEM" | "TOOL";
  senderName: string;
  content: string;
  isEdited: boolean;
  createdAt: string;
  metadata?: any;
  versions?: MessageVersion[];
}

interface ChatContainerProps {
  conversation: any;
  onUpdateConversation?: () => void;
}

export function ChatContainer({ conversation, onUpdateConversation }: ChatContainerProps) {
  const [messages, setMessages] = useState<Message[]>(conversation.messages || []);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(conversation.activeModel || "exploit");
  const [agentMode, setAgentMode] = useState<"AGENT" | "CHAT_ONLY">("AGENT");
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [onlyCombos, setOnlyCombos] = useState(true);

  // Toast
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // Tool executions feedback
  const [resolvingExecId, setResolvingExecId] = useState<string | null>(null);

  // Edit message state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editReason, setEditReason] = useState("");
  const [activeVersionView, setActiveVersionView] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, agentStatus]);

  useEffect(() => {
    if (conversation?.messages) {
      setMessages((prev) => {
        const pendingTemps = prev.filter((m) => m.id.startsWith("temp-"));
        const existingIds = new Set(conversation.messages.map((m: any) => m.id));
        const merged = [
          ...conversation.messages,
          ...pendingTemps.filter((t) => !existingIds.has(t.id)),
        ];
        return merged;
      });
    }
  }, [conversation?.id, conversation?.updatedAt]);

  useEffect(() => {
    // Load synced models from API
    fetch("/api/ai/models")
      .then((r) => r.json())
      .then((d) => {
        if (d.models && d.models.length > 0) {
          setAvailableModels(d.models);
        }
      })
      .catch(() => {});

    // Load integrations for default model fallback
    fetch("/api/ai/integrations")
      .then((r) => r.json())
      .then((d) => {
        const ints = d.integrations || [];
        setIntegrations(ints);
        if (!conversation.activeModel && ints.length > 0) {
          const def = ints[0].defaultCombo || ints[0].defaultModel;
          if (def) setSelectedModel(def);
        }
      })
      .catch(() => {});
  }, [conversation.activeModel]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() || isSending) return;

    setChatError(null);
    setIsSending(true);
    setAgentStatus(agentMode === "AGENT" ? "Agente analisando ferramentas e contexto..." : "Consultando resposta da IA...");
    const text = inputValue;
    setInputValue("");

    // Optimistically add user message to list
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      senderType: "USER",
      senderName: "Você",
      content: text,
      isEdited: false,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          content: text,
          model: selectedModel,
          agentMode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setChatError(data.error || "Falha na comunicação com o assistente.");
        if (data.userMessage) {
          setMessages((prev) =>
            prev.map((m) => (m.id === tempUserMsg.id ? data.userMessage : m))
          );
        }
        setAgentStatus(null);
        setIsSending(false);
        return;
      }

      // Reconcile user message: replace ONLY tempUserMsg.id with persisted data.userMessage
      setMessages((prev) => {
        const realUserMsg = data.userMessage || tempUserMsg;
        const replaced = prev.map((m) => (m.id === tempUserMsg.id ? realUserMsg : m));
        const hasUserMsg = replaced.some((m) => m.id === realUserMsg.id);
        const listWithUser = hasUserMsg
          ? replaced
          : [...replaced.filter((m) => m.id !== tempUserMsg.id), realUserMsg];

        if (data.message && !listWithUser.some((m) => m.id === data.message.id)) {
          return [...listWithUser, data.message];
        }
        return listWithUser;
      });

      if (onUpdateConversation) onUpdateConversation();
    } catch (err: any) {
      console.error("Chat error:", err);
      setChatError("Falha de rede ou timeout ao conectar com o OmniRoute.");
    } finally {
      setIsSending(false);
      setAgentStatus(null);
    }
  };

  const handleApproveTool = async (executionId: string, action: "approve" | "reject") => {
    setResolvingExecId(executionId);
    try {
      const res = await fetch(`/api/ai/executions/${executionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (res.ok) {
        showToast(action === "approve" ? "Ação aprovada e aplicada no HealthVault!" : "Ação rejeitada.");
        setMessages((prev) =>
          prev.map((m) => {
            if (m.metadata?.toolExecutions && Array.isArray(m.metadata.toolExecutions)) {
              return {
                ...m,
                metadata: {
                  ...m.metadata,
                  toolExecutions: m.metadata.toolExecutions.map((e: any) =>
                    e.output?.execution_id === executionId
                      ? {
                          ...e,
                          output: {
                            ...e.output,
                            requires_approval: false,
                            resolvedAction: action,
                          },
                        }
                      : e
                  ),
                },
              };
            }
            return m;
          })
        );

        if (action === "approve" && onUpdateConversation) {
          onUpdateConversation();
        }
      } else {
        showToast("Erro ao processar aprovação.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    } finally {
      setResolvingExecId(null);
    }
  };

  const handleSaveEdit = async (messageId: string) => {
    if (!editContent.trim()) return;

    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: editContent,
          reason: editReason || "Correção de dados clínicos",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, content: data.message.content, isEdited: true } : m))
        );
        setEditingMessageId(null);
        setEditContent("");
        setEditReason("");
        showToast("Mensagem atualizada e versão histórica arquivada!");
      }
    } catch (err) {
      console.error("Failed to edit message:", err);
    }
  };

  const latestRecommendation = conversation.recommendations?.[0] || null;

  // Filtered models for select
  const displayedModels = onlyCombos
    ? availableModels.filter((m) => m.isCombo)
    : availableModels;

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Top Model Selector & Status Bar */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          {/* Model / Combo Picker */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 font-mono">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-transparent text-slate-200 focus:outline-none cursor-pointer max-w-[220px] truncate"
              >
                {displayedModels.length > 0 ? (
                  displayedModels.map((m) => (
                    <option key={m.id} value={m.externalId} className="bg-slate-900 text-slate-100">
                      {m.displayName || m.externalId} {m.isCombo ? "(combo)" : ""}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="exploit" className="bg-slate-900 text-slate-100">exploit (combo)</option>
                    <option value="demigod-flash" className="bg-slate-900 text-slate-100">demigod-flash (combo)</option>
                    <option value="claude-3-5-sonnet" className="bg-slate-900 text-slate-100">claude-3-5-sonnet</option>
                    <option value="gpt-4o" className="bg-slate-900 text-slate-100">gpt-4o</option>
                  </>
                )}
              </select>
            </div>

            {/* Toggle: Apenas Combos vs Todos */}
            <button
              type="button"
              onClick={() => setOnlyCombos(!onlyCombos)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-mono text-[11px] font-semibold border transition-colors ${
                onlyCombos
                  ? "bg-emerald-950/80 border-emerald-600/50 text-emerald-300"
                  : "bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
              title={onlyCombos ? "Mostrando apenas Combos (clique para listar todos)" : "Mostrando todos os modelos (clique para filtrar apenas combos)"}
            >
              <Filter className="w-3 h-3" />
              <span>{onlyCombos ? "Apenas Combos" : `Todos (${availableModels.length})`}</span>
            </button>
          </div>

          {/* Mode Switcher: Agent vs Chat Only */}
          <div className="flex items-center bg-slate-850 p-0.5 rounded-lg border border-slate-700/80 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setAgentMode("AGENT")}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors ${
                agentMode === "AGENT"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              title="Modo Agente: Executa leitura e escrita de dados com tools"
            >
              <Zap className="w-3 h-3 text-amber-300" />
              <span>Modo Agente</span>
            </button>
            <button
              type="button"
              onClick={() => setAgentMode("CHAT_ONLY")}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors ${
                agentMode === "CHAT_ONLY"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              title="Chat Apenas: Apenas conversação, sem execução de ferramentas"
            >
              <MessageCircle className="w-3 h-3" />
              <span>Chat Apenas</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/settings/integrations"
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-emerald-300 transition-colors"
          >
            <Settings className="w-3 h-3" />
            <span>Configurar Conexões</span>
          </Link>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 p-6 overflow-y-auto space-y-4">
        {messages.map((msg) => {
          const isUser = msg.senderType === "USER";

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-2xl ${
                isUser ? "ml-auto" : "mr-auto"
              }`}
            >
              {/* Message Header */}
              <div className="flex items-center gap-2 mb-1 px-1 text-[11px] text-slate-400 font-medium">
                {isUser ? (
                  <>
                    <span>Você</span>
                    <User className="w-3 h-3 text-emerald-400" />
                  </>
                ) : (
                  <>
                    <Bot className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-blue-300 font-semibold">{msg.senderName}</span>
                    <span className="px-1.5 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-800/40 text-[9px] font-bold">
                      IA
                    </span>
                  </>
                )}
                <span>•</span>
                <span>
                  {new Date(msg.createdAt).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {msg.isEdited && (
                  <span className="text-slate-500 flex items-center gap-0.5 text-[10px] italic">
                    <Edit2 className="w-2.5 h-2.5" /> (editado)
                  </span>
                )}
              </div>

              {/* Message Bubble */}
              <div
                className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm relative group ${
                  isUser ? "chat-bubble-user" : "chat-bubble-ai"
                }`}
              >
                {editingMessageId === msg.id ? (
                  <div className="space-y-2 min-w-[280px]">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full bg-slate-900 text-slate-100 p-2 rounded border border-slate-700 text-xs focus:outline-none focus:border-emerald-500"
                      rows={3}
                    />
                    <input
                      type="text"
                      placeholder="Motivo da alteração"
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      className="w-full bg-slate-900 text-slate-100 p-1.5 rounded border border-slate-700 text-xs focus:outline-none focus:border-emerald-500"
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setEditingMessageId(null)}
                        className="px-2.5 py-1 text-xs bg-slate-800 text-slate-300 rounded hover:bg-slate-700"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => handleSaveEdit(msg.id)}
                        className="px-2.5 py-1 text-xs bg-emerald-600 text-white rounded font-medium hover:bg-emerald-500"
                      >
                        Salvar Versão
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <MessageContent content={msg.content} senderType={msg.senderType} />

                    {msg.metadata?.sources && Array.isArray(msg.metadata.sources) && msg.metadata.sources.length > 0 && (
                      <ResearchSourcesCollapsible
                        sources={msg.metadata.sources}
                        runId={msg.metadata.researchRunId}
                        provider={msg.metadata.researchProvider}
                      />
                    )}

                    {/* Per-message Tool Executions */}
                    {msg.metadata?.toolExecutions && Array.isArray(msg.metadata.toolExecutions) && (
                      <MessageToolExecutions
                        executions={msg.metadata.toolExecutions}
                        onApprove={handleApproveTool}
                        resolvingExecId={resolvingExecId}
                      />
                    )}

                    {/* Edit trigger */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingMessageId(msg.id);
                          setEditContent(msg.content);
                        }}
                        className="p-1 rounded bg-black/40 hover:bg-black/60 text-slate-300"
                        title="Editar mensagem"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      {msg.versions && msg.versions.length > 0 && (
                        <button
                          onClick={() =>
                            setActiveVersionView(activeVersionView === msg.id ? null : msg.id)
                          }
                          className="p-1 rounded bg-black/40 hover:bg-black/60 text-slate-300"
                          title="Ver versões anteriores"
                        >
                          <History className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Version History Drawer */}
              {activeVersionView === msg.id && msg.versions && (
                <div className="mt-2 p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 space-y-2 w-full">
                  <span className="font-semibold text-slate-400 block border-b border-slate-800 pb-1">
                    Histórico de edições desta mensagem:
                  </span>
                  {msg.versions.map((v) => (
                    <div key={v.id} className="p-2 rounded bg-slate-950/60 border border-slate-800 text-[11px]">
                      <div className="flex justify-between text-slate-400 mb-1">
                        <span>v{v.versionNumber} ({v.editedBy})</span>
                        <span>{new Date(v.createdAt).toLocaleString("pt-BR")}</span>
                      </div>
                      <div className="text-slate-200 line-through opacity-80">{v.content}</div>
                      {v.reason && <div className="text-[10px] text-emerald-400 mt-1">Motivo: {v.reason}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* In-chat thinking status */}
        {agentStatus && (
          <div className="flex items-center gap-2 text-xs text-emerald-400 py-2 animate-pulse">
            <Sparkles className="w-4 h-4 text-emerald-400 animate-spin" />
            <span>{agentStatus}</span>
          </div>
        )}

        {/* In-chat error alert */}
        {chatError && (
          <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{chatError}</span>
            </div>
            <Link
              href="/settings/integrations"
              className="px-2.5 py-1 rounded bg-rose-900/50 hover:bg-rose-900 text-rose-200 text-[11px] font-semibold transition-colors"
            >
              Ver Configurações
            </Link>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/60 backdrop-blur-md">
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={
              agentMode === "AGENT"
                ? "Converse com o agente, solicite ajustes de dose, dieta ou relate pesagens..."
                : "Digite sua mensagem em modo chat..."
            }
            disabled={isSending}
            className="flex-1 bg-slate-950 text-slate-100 placeholder-slate-500 px-4 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-emerald-500/80 text-sm transition-colors"
          />

          <button
            type="submit"
            disabled={isSending || !inputValue.trim()}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-semibold text-sm flex items-center gap-1.5 transition-colors shadow-lg shadow-emerald-950/40"
          >
            <Send className="w-4 h-4" />
            <span>Enviar</span>
          </button>
        </form>
      </div>

      {/* Pinned Latest Recommendation Panel */}
      {latestRecommendation && (
        <LatestRecommendationPanel recommendation={latestRecommendation} />
      )}

      {/* Toast Notification */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
