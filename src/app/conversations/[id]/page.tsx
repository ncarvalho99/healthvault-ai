"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { ChatContainer } from "@/components/chat/ChatContainer";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toast } from "@/components/ui/Toast";
import { ArrowLeft, MessageSquare, Sparkles, Trash2 } from "lucide-react";

export default function ConversationDetailPage({ params }: { params: { id: string } }) {
  const [conversation, setConversation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  };

  const loadConversation = () => {
    fetch(`/api/conversations/${params.id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Conversation not found");
        return res.json();
      })
      .then((data) => {
        setConversation(data.conversation);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error loading conversation:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadConversation();
  }, [params.id]);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/conversations/${params.id}`, { method: "DELETE" });
      if (res.ok) {
        window.location.href = "/conversations";
      } else {
        showToast("Erro ao excluir conversa.", "error");
        setIsDeleting(false);
      }
    } catch {
      showToast("Falha de rede ao excluir conversa.", "error");
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 text-slate-400 text-sm">
        Carregando conversa clínica...
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 p-6 space-y-4">
        <p className="text-slate-400 text-sm">Conversa não encontrada ou sem permissão de acesso.</p>
        <Link
          href="/conversations"
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-slate-200 rounded-xl text-xs hover:bg-slate-700"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar para Conversas
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Conversation Top Header */}
      <div className="h-16 px-6 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/conversations"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Voltar à lista"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-400" />
              {conversation.title}
            </h2>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span>{conversation.messages?.length || 0} mensagens</span>
              {conversation.tags?.length > 0 && (
                <>
                  <span>•</span>
                  <span>{conversation.tags.join(", ")}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {conversation.recommendations?.[0] && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 mr-2">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>Protocolo Ativo Vinculado</span>
            </div>
          )}

          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-800/40 transition-colors"
            title="Excluir Conversa"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Chat Flow */}
      <div className="flex-1 overflow-hidden">
        <ChatContainer
          conversation={conversation}
          onUpdateConversation={loadConversation}
        />
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Excluir Conversa"
        message={`Deseja realmente excluir a conversa '${conversation.title}'? Todo o histórico de mensagens será permanentemente removido.`}
        confirmText="Excluir Conversa"
        cancelText="Cancelar"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

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
