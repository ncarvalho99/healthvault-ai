"use client";

import React, { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toast } from "@/components/ui/Toast";
import {
  Clock,
  Pill,
  Utensils,
  Scale,
  HeartPulse,
  FileSpreadsheet,
  Calendar,
  Trash2,
} from "lucide-react";

export default function TimelinePage() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Deletion modal state
  const [deletingEvent, setDeletingEvent] = useState<{ id: string; title: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  };

  const loadTimeline = () => {
    setLoading(true);
    fetch("/api/timeline")
      .then((res) => res.json())
      .then((data) => {
        setEvents(data.events || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load timeline:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadTimeline();
  }, []);

  const executeDeleteEvent = async () => {
    if (!deletingEvent) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/timeline?eventId=${encodeURIComponent(deletingEvent.id)}`, {
        method: "DELETE",
      });

      if (res.ok) {
        showToast(`Evento '${deletingEvent.title}' removido da linha do tempo.`);
        setDeletingEvent(null);
        loadTimeline();
      } else {
        showToast("Erro ao excluir evento.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const executeClearAll = async () => {
    setIsClearingAll(true);
    try {
      const res = await fetch("/api/timeline?action=clearAll", { method: "DELETE" });
      if (res.ok) {
        showToast("Linha do tempo limpa com sucesso!");
        setShowClearAllConfirm(false);
        loadTimeline();
      } else {
        showToast("Erro ao limpar linha do tempo.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    } finally {
      setIsClearingAll(false);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "MEDICATION":
        return <Pill className="w-4 h-4 text-emerald-400" />;
      case "DIET":
        return <Utensils className="w-4 h-4 text-amber-400" />;
      case "METRIC":
        return <Scale className="w-4 h-4 text-blue-400" />;
      case "SYMPTOM":
        return <HeartPulse className="w-4 h-4 text-rose-400" />;
      case "LAB":
        return <FileSpreadsheet className="w-4 h-4 text-cyan-400" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
      <Header
        title="Linha do Tempo Clínica Unificada"
        subtitle="Evolução cronológica correlacionando alterações de dosagem, nutrição, exames e sintomas"
      />

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100">Registro Temporal de Eventos</h3>
            <p className="text-xs text-slate-400">
              Apresenta a correlação temporal entre mudanças terapêuticas e respostas fisiológicas registradas.
            </p>
          </div>

          {events.length > 0 && (
            <button
              onClick={() => setShowClearAllConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/60 border border-rose-800/50 text-rose-300 rounded-lg text-xs font-semibold transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Limpar Registros da Linha do Tempo</span>
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-center py-20 text-slate-400 text-sm">Carregando linha do tempo...</div>
        ) : events.length === 0 ? (
          <div className="text-center py-20 text-slate-500 text-sm">Nenhum evento registrado ainda.</div>
        ) : (
          <div className="relative border-l-2 border-slate-800 ml-4 pl-6 space-y-6">
            {events.map((evt) => (
              <div key={evt.id} className="relative group">
                {/* Dot */}
                <div className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full bg-slate-950 border-2 border-slate-700 group-hover:border-emerald-500 flex items-center justify-center transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400 group-hover:bg-emerald-400" />
                </div>

                {/* Event Card */}
                <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition-all space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      {getIcon(evt.type)}
                      <span className="font-semibold text-slate-200">{evt.title}</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 flex items-center gap-1 font-mono text-[11px]">
                        <Calendar className="w-3 h-3" />
                        {new Date(evt.date).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </span>

                      <button
                        onClick={() => setDeletingEvent({ id: evt.id, title: evt.title })}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-800/40 transition-colors"
                        title="Excluir evento da linha do tempo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {evt.subtitle && (
                    <div className="text-xs font-mono text-emerald-400 font-medium">
                      {evt.subtitle}
                    </div>
                  )}

                  {evt.description && (
                    <p className="text-xs text-slate-300 italic bg-slate-950/40 p-2 rounded border border-slate-800/80">
                      {evt.description}
                    </p>
                  )}

                  {evt.actorName && (
                    <div className="text-[10px] text-slate-500">
                      Registrado por: {evt.actorName} ({evt.actorType || "USER"})
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Single Event Modal */}
      <ConfirmDialog
        isOpen={!!deletingEvent}
        title="Excluir Evento da Linha do Tempo"
        message={`Deseja realmente remover o evento '${deletingEvent?.title}' da sua linha do tempo?`}
        confirmText="Excluir Evento"
        cancelText="Cancelar"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={executeDeleteEvent}
        onCancel={() => setDeletingEvent(null)}
      />

      {/* Clear All Modal */}
      <ConfirmDialog
        isOpen={showClearAllConfirm}
        title="Limpar Registros da Linha do Tempo"
        message="Atenção: Esta ação removerá todos os registros de pesagens corporais, sintomas e exames da sua linha do tempo. Deseja prosseguir?"
        confirmText="Limpar Tudo"
        cancelText="Cancelar"
        variant="danger"
        isLoading={isClearingAll}
        onConfirm={executeClearAll}
        onCancel={() => setShowClearAllConfirm(false)}
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
