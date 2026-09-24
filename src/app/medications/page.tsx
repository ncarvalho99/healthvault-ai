"use client";

import React, { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toast } from "@/components/ui/Toast";
import {
  Pill,
  Plus,
  History,
  TrendingUp,
  Clock,
  User,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  Trash2,
} from "lucide-react";

export default function MedicationsPage() {
  const [medications, setMedications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMed, setSelectedMed] = useState<any | null>(null);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // New Medication Modal State
  const [isNewMedOpen, setIsNewMedOpen] = useState(false);
  const [name, setName] = useState("");
  const [genericName, setGenericName] = useState("");
  const [category, setCategory] = useState("");
  const [form, setForm] = useState("Subcutâneo");
  const [doseValue, setDoseValue] = useState(0.25);
  const [doseUnit, setDoseUnit] = useState("mg");
  const [frequency, setFrequency] = useState("1x/semana");
  const [schedule, setSchedule] = useState("Manhã em jejum");

  // Adjust Dose Modal State
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [adjustMedId, setAdjustMedId] = useState<string | null>(null);
  const [newDoseValue, setNewDoseValue] = useState<number>(0.5);
  const [newDoseUnit, setNewDoseUnit] = useState("mg");
  const [newFrequency, setNewFrequency] = useState("1x/semana");
  const [changeReason, setChangeReason] = useState("");

  // Deletion modal state
  const [deletingMed, setDeletingMed] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  };

  const loadMedications = () => {
    setLoading(true);
    fetch("/api/medications?active=false")
      .then((res) => res.json())
      .then((data) => {
        setMedications(data.medications || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load medications:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadMedications();
  }, []);

  const openHistory = (med: any) => {
    setSelectedMed(med);
    setLoadingHistory(true);
    fetch(`/api/medications/${med.id}/versions`)
      .then((res) => res.json())
      .then((data) => {
        setHistoryData(data.versions || []);
        setLoadingHistory(false);
      })
      .catch((err) => {
        console.error("Failed to load history:", err);
        setLoadingHistory(false);
      });
  };

  const handleCreateMed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      const res = await fetch("/api/medications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          genericName,
          category,
          form,
          doseValue: Number(doseValue),
          doseUnit,
          frequency,
          schedule,
          changeReason: "Iniciação do medicamento",
        }),
      });

      if (res.ok) {
        setIsNewMedOpen(false);
        setName("");
        setGenericName("");
        showToast("Medicamento cadastrado com sucesso!");
        loadMedications();
      } else {
        showToast("Erro ao cadastrar medicamento.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    }
  };

  const handleAdjustDose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustMedId || !changeReason.trim()) return;

    try {
      const res = await fetch(`/api/medications/${adjustMedId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doseValue: Number(newDoseValue),
          doseUnit: newDoseUnit,
          frequency: newFrequency,
          changeReason,
        }),
      });

      if (res.ok) {
        setIsAdjustModalOpen(false);
        setChangeReason("");
        showToast("Nova versão de dosagem gravada com sucesso!");
        loadMedications();
        if (selectedMed?.id === adjustMedId) {
          openHistory(selectedMed);
        }
      } else {
        showToast("Erro ao ajustar dosagem.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    }
  };

  const executeDeleteMed = async () => {
    if (!deletingMed) return;
    setIsDeleting(true);

    try {
      const res = await fetch(`/api/medications/${deletingMed.id}`, { method: "DELETE" });
      if (res.ok) {
        showToast(`Medicamento '${deletingMed.name}' excluído com sucesso.`);
        setDeletingMed(null);
        loadMedications();
      } else {
        showToast("Erro ao excluir medicamento.", "error");
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
        title="Gestão de Medicamentos & Dosagens"
        subtitle="Controle posológico com versionamento estrito e histórico de titulações"
      />

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        {/* Top Control Bar */}
        <div className="flex items-center justify-between bg-slate-900/60 p-4 rounded-xl border border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-100">Medicamentos Cadastrados</h3>
            <p className="text-xs text-slate-400">
              Nenhuma alteração substitui silenciosamente o registro antigo. Toda mudança gera uma nova versão auditável.
            </p>
          </div>

          <button
            onClick={() => setIsNewMedOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-950/50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Adicionar Medicamento</span>
          </button>
        </div>

        {/* Medications Grid */}
        {loading ? (
          <div className="text-center py-20 text-slate-400 text-sm">Carregando medicamentos...</div>
        ) : medications.length === 0 ? (
          <div className="text-center py-20 text-slate-500 text-sm space-y-2">
            <Pill className="w-10 h-10 mx-auto text-slate-700" />
            <p>Nenhum medicamento registrado.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {medications.map((med) => {
              const currentVer = med.versions?.[0];
              const versionCount = med._count?.versions || 1;

              return (
                <div
                  key={med.id}
                  className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-100">{med.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          med.isActive
                            ? "bg-emerald-950 text-emerald-400 border border-emerald-800/40"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {med.isActive ? "Ativo" : "Descontinuado"}
                      </span>
                    </div>

                    {med.genericName && (
                      <p className="text-xs text-slate-400 italic">Genérico: {med.genericName}</p>
                    )}

                    {med.category && (
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                        {med.category}
                      </span>
                    )}

                    <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs space-y-1">
                      <div className="flex justify-between font-mono">
                        <span className="text-slate-400">Dose Vigente:</span>
                        <strong className="text-emerald-400 text-sm">
                          {currentVer?.doseValue} {currentVer?.doseUnit}
                        </strong>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Frequência:</span>
                        <span>{currentVer?.frequency}</span>
                      </div>
                      {currentVer?.schedule && (
                        <div className="flex justify-between text-slate-400">
                          <span>Horário:</span>
                          <span>{currentVer?.schedule}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                    <button
                      onClick={() => openHistory(med)}
                      className="inline-flex items-center gap-1.5 text-slate-300 hover:text-emerald-300 transition-colors font-medium"
                    >
                      <History className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Histórico (v{versionCount})</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setAdjustMedId(med.id);
                          setNewDoseValue(currentVer?.doseValue || 0.5);
                          setNewDoseUnit(currentVer?.doseUnit || "mg");
                          setNewFrequency(currentVer?.frequency || "1x/semana");
                          setIsAdjustModalOpen(true);
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors"
                      >
                        Ajustar Dose
                      </button>

                      <button
                        onClick={() => setDeletingMed({ id: med.id, name: med.name })}
                        className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-800/40 transition-colors"
                        title="Excluir Medicamento"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        isOpen={!!deletingMed}
        title="Excluir Medicamento"
        message={`Deseja realmente excluir o medicamento '${deletingMed?.name}' e todo o seu histórico de versões posológicas?`}
        confirmText="Excluir Medicamento"
        cancelText="Cancelar"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={executeDeleteMed}
        onCancel={() => setDeletingMed(null)}
      />

      {/* Toast Notification */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {/* History Drawer Modal */}
      {selectedMed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <History className="w-5 h-5 text-emerald-400" />
                  Evolução de Dosagem — {selectedMed.name}
                </h3>
                <p className="text-xs text-slate-400">
                  Histórico completo de alterações e motivos de ajuste clínico
                </p>
              </div>
              <button
                onClick={() => setSelectedMed(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {loadingHistory ? (
                <div className="py-12 text-center text-slate-400 text-sm">Carregando versões...</div>
              ) : historyData.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-sm">Nenhum histórico encontrado.</div>
              ) : (
                historyData.map((v) => (
                  <div
                    key={v.id}
                    className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono text-xs font-bold">
                          v{v.versionNumber}
                        </span>
                        <span className="text-sm font-bold font-mono text-slate-100">
                          {v.doseValue} {v.doseUnit}
                        </span>
                        <span className="text-xs text-slate-400 font-sans">• {v.frequency}</span>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {new Date(v.createdAt).toLocaleDateString("pt-BR")}
                      </span>
                    </div>

                    {v.changeReason && (
                      <p className="text-xs text-slate-300 bg-slate-900/80 p-2 rounded border-l-2 border-emerald-500">
                        <strong className="text-slate-400">Motivo: </strong>
                        {v.changeReason}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                      <span>Autor: {v.actorName || v.actorType}</span>
                      {v.schedule && <span>Horário: {v.schedule}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex justify-end">
              <button
                onClick={() => setSelectedMed(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Dose Modal */}
      {isAdjustModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              Ajustar Dosagem (Cria Nova Versão)
            </h3>

            <form onSubmit={handleAdjustDose} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Nova Dose</label>
                  <input
                    type="number"
                    step="any"
                    value={newDoseValue}
                    onChange={(e) => setNewDoseValue(Number(e.target.value))}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-sm text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Unidade</label>
                  <input
                    type="text"
                    value={newDoseUnit}
                    onChange={(e) => setNewDoseUnit(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-sm text-slate-100 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Frequência</label>
                <input
                  type="text"
                  value={newFrequency}
                  onChange={(e) => setNewFrequency(e.target.value)}
                  placeholder="Ex: 1x/semana ou 2x/dia"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Motivo da Alteração (Obrigatório para Auditoria)
                </label>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Ex: Avanço de protocolo semana 5; boa tolerância sem sintomas gastrointestinais."
                  required
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-300 bg-slate-800 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-500"
                >
                  Gravar Nova Versão
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Medication Modal */}
      {isNewMedOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-400" />
              Adicionar Novo Medicamento
            </h3>

            <form onSubmit={handleCreateMed} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nome Comercial / Droga</label>
                <input
                  type="text"
                  placeholder="Ex: Semaglutida (Ozempic)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-sm text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Dose Inicial</label>
                  <input
                    type="number"
                    step="any"
                    value={doseValue}
                    onChange={(e) => setDoseValue(Number(e.target.value))}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-sm text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Unidade</label>
                  <input
                    type="text"
                    value={doseUnit}
                    onChange={(e) => setDoseUnit(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-sm text-slate-100 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Frequência</label>
                <input
                  type="text"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  placeholder="Ex: 1x/semana"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewMedOpen(false)}
                  className="px-4 py-2 text-xs text-slate-300 bg-slate-800 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-500"
                >
                  Salvar Medicamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
