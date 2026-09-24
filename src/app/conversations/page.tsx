"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toast } from "@/components/ui/Toast";
import {
  MessageSquare,
  Plus,
  Search,
  Star,
  Tag,
  Clock,
  ArrowRight,
  Trash2,
} from "lucide-react";

export default function ConversationsListPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTags, setNewTags] = useState("");

  // Delete modal state
  const [deletingConv, setDeletingConv] = useState<{ id: string; title: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  };

  const loadConversations = () => {
    setLoading(true);
    let url = "/api/conversations?";
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (favoriteOnly) url += `favorite=true&`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setConversations(data.conversations || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load conversations:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadConversations();
  }, [favoriteOnly]);

  const handleCreateConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const tagsArray = newTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);

      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          tags: tagsArray,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setIsNewModalOpen(false);
        setNewTitle("");
        setNewTags("");
        window.location.href = `/conversations/${data.conversation.id}`;
      }
    } catch (err) {
      console.error("Failed to create conversation:", err);
    }
  };

  const executeDeleteConversation = async () => {
    if (!deletingConv) return;
    setIsDeleting(true);

    try {
      const res = await fetch(`/api/conversations/${deletingConv.id}`, { method: "DELETE" });
      if (res.ok) {
        showToast(`Conversa '${deletingConv.title}' excluída.`);
        setDeletingConv(null);
        loadConversations();
      } else {
        showToast("Erro ao excluir conversa.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
      <Header
        title="Histórico de Conversas"
        subtitle="Diálogos estruturados com agentes de IA e notas clínicas de acompanhamento"
      />

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        {/* Controls Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
          <div className="flex items-center gap-3 w-full sm:w-auto flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar conversas por título ou resumo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadConversations()}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <button
              onClick={loadConversations}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium"
            >
              Buscar
            </button>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              onClick={() => setFavoriteOnly(!favoriteOnly)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                favoriteOnly
                  ? "bg-amber-950/60 border-amber-600/50 text-amber-300"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              <Star className="w-3.5 h-3.5" />
              <span>Favoritos</span>
            </button>

            <button
              onClick={() => setIsNewModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-950/50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Nova Conversa</span>
            </button>
          </div>
        </div>

        {/* Conversations Grid */}
        {loading ? (
          <div className="text-center py-20 text-slate-400 text-sm">Carregando conversas...</div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-20 text-slate-500 text-sm space-y-3">
            <MessageSquare className="w-10 h-10 mx-auto text-slate-700" />
            <p>Nenhuma conversa encontrada.</p>
            <button
              onClick={() => setIsNewModalOpen(true)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-medium inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Iniciar Primeira Conversa
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between group space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/conversations/${conv.id}`}
                      className="font-semibold text-sm text-slate-100 hover:text-emerald-300 transition-colors line-clamp-1"
                    >
                      {conv.title}
                    </Link>
                    <div className="flex items-center gap-1">
                      {conv.isFavorite && (
                        <Star className="w-4 h-4 text-amber-400 fill-amber-400 shrink-0" />
                      )}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeletingConv({ id: conv.id, title: conv.title });
                        }}
                        className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                        title="Excluir conversa"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                    {conv.summary || "Nenhum resumo gerado ainda. Clique para abrir o chat."}
                  </p>
                </div>

                <div className="space-y-3 pt-2 border-t border-slate-800/60">
                  {/* Tags */}
                  {conv.tags && conv.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {conv.tags.map((tag: string, i: number) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700/60 flex items-center gap-1"
                        >
                          <Tag className="w-2.5 h-2.5 text-slate-500" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Metadata & Open CTA */}
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(conv.updatedAt).toLocaleDateString("pt-BR")}
                    </span>

                    <Link
                      href={`/conversations/${conv.id}`}
                      className="text-emerald-400 hover:translate-x-1 transition-transform flex items-center gap-1 font-medium"
                    >
                      Abrir <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Custom Confirm Dialog for Delete Conversation */}
      <ConfirmDialog
        isOpen={!!deletingConv}
        title="Excluir Conversa"
        message={`Deseja realmente excluir a conversa '${deletingConv?.title}'? Todas as mensagens e histórico desta conversa serão removidos.`}
        confirmText="Excluir Conversa"
        cancelText="Cancelar"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={executeDeleteConversation}
        onCancel={() => setDeletingConv(null)}
      />

      {/* Toast Notification */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {/* New Conversation Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-400" />
              Iniciar Nova Conversa Clínica
            </h3>

            <form onSubmit={handleCreateConversation} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Título da Sessão / Conversa
                </label>
                <input
                  type="text"
                  placeholder="Ex: Ajuste de Dosagem Retatrutida Semana 4"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Tags (separadas por vírgula)
                </label>
                <input
                  type="text"
                  placeholder="exame, cutting, glp1, tiroide"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-300 bg-slate-800 rounded-xl hover:bg-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-500"
                >
                  Criar e Abrir Chat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
