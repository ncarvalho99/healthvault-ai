"use client";

import React, { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { SafetyBadge } from "@/components/ui/SafetyBadge";
import { ClinicalMarkdown } from "@/components/ui/ClinicalMarkdown";
import { VersionDiffModal } from "@/components/recommendations/VersionDiffModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toast } from "@/components/ui/Toast";
import { Sparkles, GitCommit, Clock, ArrowRight, Plus, History, Trash2, Edit3 } from "lucide-react";
import { recommendationOriginLabel } from "@/lib/recommendation-origin";

export default function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecId, setSelectedRecId] = useState<string | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  // Edit / Update Recommendation Modal
  const [editingRec, setEditingRec] = useState<any | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editStatus, setEditStatus] = useState("AI_SUGGESTION");

  // Deletion state
  const [deletingRec, setDeletingRec] = useState<{ id: string; title: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // New Recommendation Form State
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  };

  const loadRecommendations = () => {
    setLoading(true);
    fetch("/api/recommendations")
      .then((res) => res.json())
      .then((data) => {
        setRecommendations(data.recommendations || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load recommendations:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadRecommendations();
  }, []);

  const handleCreateRecommendation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      const res = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          notes,
          changeReason: "Iniciação do protocolo",
        }),
      });

      if (res.ok) {
        setIsNewModalOpen(false);
        setTitle("");
        setNotes("");
        showToast("Protocolo de recomendação criado com sucesso!");
        loadRecommendations();
      } else {
        showToast("Erro ao criar protocolo.", "error");
      }
    } catch (err) {
      showToast("Falha ao comunicar com o servidor.", "error");
    }
  };

  const executeDeleteRec = async () => {
    if (!deletingRec) return;
    setIsDeleting(true);

    try {
      const res = await fetch(`/api/recommendations/${deletingRec.id}`, { method: "DELETE" });
      if (res.ok) {
        showToast(`Recomendação '${deletingRec.title}' excluída.`);
        setDeletingRec(null);
        loadRecommendations();
      } else {
        showToast("Erro ao excluir recomendação.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUpdateRecommendation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRec || !editReason.trim()) return;

    try {
      const res = await fetch(`/api/recommendations/${editingRec.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          notes: editNotes,
          status: editStatus,
          changeReason: editReason,
        }),
      });

      if (res.ok) {
        setEditingRec(null);
        setEditReason("");
        showToast("Nova versão do protocolo gravada com sucesso!");
        loadRecommendations();
      } else {
        const err = await res.json();
        showToast(err.error || "Erro ao atualizar recomendação.", "error");
      }
    } catch (err: any) {
      showToast("Falha ao atualizar: " + err.message, "error");
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
      <Header
        title="Recomendações & Protocolos Clínicos"
        subtitle="Versionamento imutável de dosagens, dietas e orientações com rastreabilidade total"
      />

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        {/* Top Action Bar */}
        <div className="flex items-center justify-between bg-slate-900/60 p-4 rounded-xl border border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-100">Protocolos Ativos</h3>
            <p className="text-xs text-slate-400">
              Cada alteração gera uma nova versão auditável vinculada à conversa de origem.
            </p>
          </div>

          <button
            onClick={() => setIsNewModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-950/50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Protocolo</span>
          </button>
        </div>

        {/* List of Recommendations */}
        {loading ? (
          <div className="text-center py-20 text-slate-400 text-sm">Carregando protocolos...</div>
        ) : recommendations.length === 0 ? (
          <div className="text-center py-20 text-slate-500 text-sm space-y-2">
            <Sparkles className="w-10 h-10 mx-auto text-slate-700" />
            <p>Nenhuma recomendação registrada ainda.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {recommendations.map((rec) => {
              const latestVer = rec.versions?.[0];
              const snapshot = (latestVer?.summarySnapshot as any) || {};

              return (
                <div
                  key={rec.id}
                  className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition-all space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono text-xs font-bold">
                        v{rec.currentVersion}
                      </span>
                      <div>
                        <h4 className="font-bold text-sm text-slate-100">{rec.title}</h4>
                        <span className="text-xs text-slate-400">
                          Origem: {recommendationOriginLabel(rec.sourceType, rec.sourceName)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <SafetyBadge status={rec.status} />

                      <button
                        onClick={() => setSelectedRecId(rec.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-colors"
                      >
                        <History className="w-3.5 h-3.5" />
                        <span>Ver Histórico & Diffs</span>
                      </button>

                      <button
                        onClick={() => {
                          setEditingRec(rec);
                          setEditTitle(rec.title);
                          setEditNotes(rec.notes || "");
                          setEditStatus(rec.status);
                        }}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                        title="Editar / Gerar Nova Versão"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => setDeletingRec({ id: rec.id, title: rec.title })}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-800/40 transition-colors"
                        title="Excluir Recomendação"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {rec.notes && (
                    <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/70">
                      <ClinicalMarkdown content={rec.notes} />
                    </div>
                  )}

                  {/* Quick Summary of Active Meds & Nutrition from Version Snapshot */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    {/* Meds snapshot */}
                    <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800">
                      <span className="text-slate-300 font-semibold block">
                        Medicamentos da v{latestVer?.versionNumber || rec.currentVersion} ({snapshot.medications?.length ?? rec.medications?.length ?? 0}):
                      </span>
                      <span className="text-[10px] text-slate-500 block mb-1.5">
                        Capturado nesta versão
                      </span>
                      {snapshot.medications && snapshot.medications.length > 0 ? (
                        <div className="space-y-1">
                          {snapshot.medications.map((m: any) => (
                            <div key={m.id} className="flex justify-between text-slate-200">
                              <span className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${m.active ? "bg-emerald-400" : "bg-slate-600"}`} />
                                {m.name}
                              </span>
                              <span className="font-mono text-emerald-400 font-bold">
                                {m.active ? (m.dose ? `${m.dose} (${m.frequency || "1x/dia"})` : "Ativo") : "Descontinuado"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : rec.medications?.length > 0 ? (
                        <div className="space-y-1">
                          {rec.medications.map((m: any) => (
                            <div key={m.id} className="flex justify-between text-slate-200">
                              <span>{m.name}</span>
                              <span className="font-mono text-emerald-400 font-bold">
                                {m.versions?.[0]?.doseValue} {m.versions?.[0]?.doseUnit} ({m.versions?.[0]?.frequency})
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">Sem medicamentos registrados nesta versão.</span>
                      )}
                    </div>

                    {/* Nutrition snapshot */}
                    <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800">
                      <span className="text-slate-300 font-semibold block">
                        Snapshot Nutricional da v{latestVer?.versionNumber || rec.currentVersion}:
                      </span>
                      <span className="text-[10px] text-slate-500 block mb-1.5">
                        Estado capturado nesta versão
                      </span>
                      {snapshot.nutrition ? (
                        <div className="flex gap-4 font-mono text-slate-200">
                          <span>
                            Cal:{" "}
                            <strong className="text-amber-300">
                              {snapshot.nutrition.calories || "-"}
                            </strong>
                          </span>
                          <span>
                            P:{" "}
                            <strong className="text-emerald-400">
                              {snapshot.nutrition.protein_g || "-"}g
                            </strong>
                          </span>
                          <span>
                            C:{" "}
                            <strong className="text-blue-400">
                              {snapshot.nutrition.carbs_g || "-"}g
                            </strong>
                          </span>
                          <span>
                            F:{" "}
                            <strong className="text-purple-400">
                              {snapshot.nutrition.fat_g || "-"}g
                            </strong>
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">Sem metas registradas nesta versão.</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Diff Modal */}
      {selectedRecId && (
        <VersionDiffModal
          recommendationId={selectedRecId}
          isOpen={true}
          onClose={() => setSelectedRecId(null)}
        />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        isOpen={!!deletingRec}
        title="Excluir Recomendação"
        message={`Deseja realmente excluir a recomendação '${deletingRec?.title}' e todo o seu histórico de versões?`}
        confirmText="Excluir Recomendação"
        cancelText="Cancelar"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={executeDeleteRec}
        onCancel={() => setDeletingRec(null)}
      />

      {/* Toast Notification */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {/* Edit Modal (Generates new version) */}
      {editingRec && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-emerald-400" />
              Editar Recomendação (Gera Versão v{editingRec.currentVersion + 1})
            </h3>

            <form onSubmit={handleUpdateRecommendation} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Título do Protocolo
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Status da Recomendação
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  <option value="AI_SUGGESTION">Sugestão de IA</option>
                  <option value="DOCTOR_RECOMMENDATION">Recomendação Médica</option>
                  <option value="CONFIRMED">Confirmado / Validado</option>
                  <option value="USER_NOTE">Nota Pessoal</option>
                  <option value="ARCHIVED">Arquivado</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Diretrizes Clínicas
                </label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Motivo da Alteração (Obrigatório para Auditoria)
                </label>
                <input
                  type="text"
                  placeholder="Ex: Ajuste após nova consulta ou exame"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingRec(null)}
                  className="px-4 py-2 text-xs text-slate-300 bg-slate-800 rounded-xl hover:bg-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-500"
                >
                  Salvar Nova Versão
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-400" />
              Novo Protocolo de Recomendação
            </h3>

            <form onSubmit={handleCreateRecommendation} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Título do Protocolo
                </label>
                <input
                  type="text"
                  placeholder="Ex: Fase de Definição 2026"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Notas / Diretrizes Clínicas
                </label>
                <textarea
                  placeholder="Instruções gerais sobre o protocolo..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  rows={2}
                />
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Dieta, medicamentos e peso deste protocolo são capturados automaticamente do estado atual do
                HealthVault. Para mudar metas nutricionais, atualize a dieta na página Dieta antes de criar o protocolo.
              </p>

              <div className="flex justify-end gap-2 pt-3">
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
                  Criar Protocolo (v1)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
