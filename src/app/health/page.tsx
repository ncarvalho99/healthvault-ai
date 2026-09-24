"use client";

import React, { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toast } from "@/components/ui/Toast";
import {
  Scale,
  HeartPulse,
  FileSpreadsheet,
  Plus,
  Trash2,
  Edit2,
  Calendar,
} from "lucide-react";

export default function HealthPage() {
  const [tab, setTab] = useState<"metrics" | "symptoms" | "labs">("metrics");
  const [metrics, setMetrics] = useState<any[]>([]);
  const [symptoms, setSymptoms] = useState<any[]>([]);
  const [labs, setLabs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Toast
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // New Metric State
  const [newWeight, setNewWeight] = useState(83.0);
  const [newBf, setNewBf] = useState(15.5);
  const [metricNotes, setMetricNotes] = useState("");

  // Edit Metric Modal State
  const [editingMetric, setEditingMetric] = useState<any | null>(null);
  const [editWeight, setEditWeight] = useState(0);
  const [editBf, setEditBf] = useState<number | undefined>(undefined);
  const [editMetricNotes, setEditMetricNotes] = useState("");

  // New Symptom State
  const [symptomName, setSymptomName] = useState("");
  const [severity, setSeverity] = useState(3);
  const [symptomTrigger, setSymptomTrigger] = useState("");

  // Edit Symptom Modal State
  const [editingSymptom, setEditingSymptom] = useState<any | null>(null);
  const [editSymptomName, setEditSymptomName] = useState("");
  const [editSeverity, setEditSeverity] = useState(3);
  const [editSymptomTrigger, setEditSymptomTrigger] = useState("");

  // New Lab State
  const [testName, setTestName] = useState("Perfil Lipídico");
  const [markerName, setMarkerName] = useState("Glicemia de Jejum");
  const [resultValue, setResultValue] = useState(88);
  const [unit, setUnit] = useState("mg/dL");

  // Edit Lab Modal State
  const [editingLab, setEditingLab] = useState<any | null>(null);
  const [editLabTestName, setEditLabTestName] = useState("");
  const [editLabMarkerName, setEditLabMarkerName] = useState("");
  const [editLabValue, setEditLabValue] = useState(0);
  const [editLabUnit, setEditLabUnit] = useState("");

  // Deletion state
  const [deletingItem, setDeletingItem] = useState<{ type: "metric" | "symptom" | "lab"; id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  };

  const loadAll = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/health/metrics").then((r) => r.json()),
      fetch("/api/health/symptoms").then((r) => r.json()),
      fetch("/api/health/labs").then((r) => r.json()),
    ])
      .then(([m, s, l]) => {
        setMetrics(m.metrics || []);
        setSymptoms(s.symptoms || []);
        setLabs(l.labs || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load health records:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleAddMetric = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/health/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weightKg: Number(newWeight),
          bodyFatPct: Number(newBf),
          notes: metricNotes,
        }),
      });
      if (res.ok) {
        setMetricNotes("");
        showToast("Medida registrada com sucesso!");
        loadAll();
      } else {
        showToast("Erro ao registrar medida.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    }
  };

  const handleSaveEditMetric = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMetric) return;

    try {
      const res = await fetch(`/api/health/metrics/${editingMetric.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weightKg: Number(editWeight),
          bodyFatPct: editBf !== undefined ? Number(editBf) : null,
          notes: editMetricNotes,
        }),
      });
      if (res.ok) {
        setEditingMetric(null);
        showToast("Medida atualizada com sucesso!");
        loadAll();
      } else {
        showToast("Erro ao atualizar medida.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    }
  };

  const handleAddSymptom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symptomName.trim()) return;
    try {
      const res = await fetch("/api/health/symptoms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symptom: symptomName,
          severity: Number(severity),
          possibleTrigger: symptomTrigger,
        }),
      });
      if (res.ok) {
        setSymptomName("");
        setSymptomTrigger("");
        showToast("Sintoma registrado com sucesso!");
        loadAll();
      } else {
        showToast("Erro ao registrar sintoma.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    }
  };

  const handleSaveEditSymptom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSymptom) return;

    try {
      const res = await fetch(`/api/health/symptoms/${editingSymptom.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symptom: editSymptomName,
          severity: Number(editSeverity),
          possibleTrigger: editSymptomTrigger,
        }),
      });
      if (res.ok) {
        setEditingSymptom(null);
        showToast("Sintoma atualizado com sucesso!");
        loadAll();
      } else {
        showToast("Erro ao atualizar sintoma.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    }
  };

  const handleAddLab = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/health/labs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testName,
          category: "Metabólico",
          testDate: new Date().toISOString(),
          markerName,
          resultValue: Number(resultValue),
          unit,
        }),
      });
      if (res.ok) {
        showToast("Exame registrado com sucesso!");
        loadAll();
      } else {
        showToast("Erro ao registrar exame.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    }
  };

  const handleSaveEditLab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLab) return;

    try {
      const res = await fetch(`/api/health/labs/${editingLab.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testName: editLabTestName,
          markerName: editLabMarkerName,
          resultValue: Number(editLabValue),
          unit: editLabUnit,
        }),
      });
      if (res.ok) {
        setEditingLab(null);
        showToast("Exame atualizado com sucesso!");
        loadAll();
      } else {
        showToast("Erro ao atualizar exame.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    }
  };

  const executeDeleteItem = async () => {
    if (!deletingItem) return;
    setIsDeleting(true);

    let url = "";
    if (deletingItem.type === "metric") url = `/api/health/metrics/${deletingItem.id}`;
    else if (deletingItem.type === "symptom") url = `/api/health/symptoms/${deletingItem.id}`;
    else if (deletingItem.type === "lab") url = `/api/health/labs/${deletingItem.id}`;

    try {
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) {
        showToast(`Registro '${deletingItem.name}' excluído.`);
        setDeletingItem(null);
        loadAll();
      } else {
        showToast("Erro ao excluir registro.", "error");
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
        title="Registros de Saúde & Biomarcadores"
        subtitle="Métricas antropométricas, monitoramento de sintomas e exames laboratoriais"
      />

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        {/* Tab Selection */}
        <div className="flex gap-2 border-b border-slate-800 pb-3">
          <button
            onClick={() => setTab("metrics")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
              tab === "metrics"
                ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Scale className="w-4 h-4" />
            <span>Peso & Composição ({metrics.length})</span>
          </button>

          <button
            onClick={() => setTab("symptoms")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
              tab === "symptoms"
                ? "bg-amber-600/20 text-amber-300 border border-amber-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <HeartPulse className="w-4 h-4" />
            <span>Sintomas & Reações ({symptoms.length})</span>
          </button>

          <button
            onClick={() => setTab("labs")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
              tab === "labs"
                ? "bg-blue-600/20 text-blue-300 border border-blue-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Exames Laboratoriais ({labs.length})</span>
          </button>
        </div>

        {/* Tab: Metrics */}
        {tab === "metrics" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <h3 className="text-sm font-bold text-slate-100">Histórico de Peso e Medidas</h3>
              <div className="space-y-2">
                {metrics.map((m) => (
                  <div
                    key={m.id}
                    className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs hover:border-slate-700 transition-colors"
                  >
                    <div>
                      <span className="font-bold font-mono text-slate-100 text-sm">
                        {m.weightKg} kg
                      </span>
                      {m.bodyFatPct && (
                        <span className="text-slate-400 ml-2 font-mono">({m.bodyFatPct}% BF)</span>
                      )}
                      {m.notes && <p className="text-slate-400 text-[11px] mt-0.5">{m.notes}</p>}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-slate-500 text-[11px]">
                        {new Date(m.date).toLocaleDateString("pt-BR")}
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingMetric(m);
                            setEditWeight(m.weightKg);
                            setEditBf(m.bodyFatPct || undefined);
                            setEditMetricNotes(m.notes || "");
                          }}
                          className="p-1.5 rounded text-slate-500 hover:text-emerald-400 hover:bg-slate-800 transition-colors"
                          title="Editar medida"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeletingItem({ type: "metric", id: m.id, name: `${m.weightKg} kg` })}
                          className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                          title="Excluir medida"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Add Metric Card */}
            <div className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 h-fit space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Registrar Nova Pesagem
              </h4>
              <form onSubmit={handleAddMetric} className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Peso (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newWeight}
                    onChange={(e) => setNewWeight(Number(e.target.value))}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Gordura Corporal (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newBf}
                    onChange={(e) => setNewBf(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Notas</label>
                  <input
                    type="text"
                    placeholder="Em jejum ao acordar"
                    value={metricNotes}
                    onChange={(e) => setMetricNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-emerald-950/50"
                >
                  Registrar Medida
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Tab: Symptoms */}
        {tab === "symptoms" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <h3 className="text-sm font-bold text-slate-100">Registro de Sintomas</h3>
              <div className="space-y-2">
                {symptoms.map((s) => (
                  <div
                    key={s.id}
                    className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs hover:border-slate-700 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100">{s.symptom}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            s.severity >= 7
                              ? "bg-rose-950 text-rose-400 border border-rose-800"
                              : "bg-amber-950 text-amber-400 border border-amber-800"
                          }`}
                        >
                          Gravidade {s.severity}/10
                        </span>
                      </div>
                      {s.possibleTrigger && (
                        <p className="text-slate-400 text-[11px] mt-0.5">
                          Gatilho: {s.possibleTrigger}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-slate-500 text-[11px]">
                        {new Date(s.date).toLocaleDateString("pt-BR")}
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingSymptom(s);
                            setEditSymptomName(s.symptom);
                            setEditSeverity(s.severity);
                            setEditSymptomTrigger(s.possibleTrigger || "");
                          }}
                          className="p-1.5 rounded text-slate-500 hover:text-amber-400 hover:bg-slate-800 transition-colors"
                          title="Editar sintoma"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeletingItem({ type: "symptom", id: s.id, name: s.symptom })}
                          className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                          title="Excluir sintoma"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Add Symptom */}
            <div className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 h-fit space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Registrar Sintoma / Reação
              </h4>
              <form onSubmit={handleAddSymptom} className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Sintoma</label>
                  <input
                    type="text"
                    placeholder="Ex: Náusea, Cefaleia, Fadiga"
                    value={symptomName}
                    onChange={(e) => setSymptomName(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Gravidade (1 a 10): {severity}
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={severity}
                    onChange={(e) => setSeverity(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Possível Gatilho</label>
                  <input
                    type="text"
                    placeholder="Ex: Pós-injeção, jejum prolongado"
                    value={symptomTrigger}
                    onChange={(e) => setSymptomTrigger(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-amber-950/50"
                >
                  Registrar Sintoma
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Tab: Labs */}
        {tab === "labs" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <h3 className="text-sm font-bold text-slate-100">Resultados de Exames</h3>
              <div className="space-y-2">
                {labs.map((l) => (
                  <div
                    key={l.id}
                    className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs hover:border-slate-700 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100">{l.markerName}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">
                          {l.testName}
                        </span>
                      </div>
                      <span className="font-mono text-emerald-400 font-bold text-sm">
                        {l.resultValue} {l.unit}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-slate-500 text-[11px]">
                        {new Date(l.testDate).toLocaleDateString("pt-BR")}
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingLab(l);
                            setEditLabTestName(l.testName);
                            setEditLabMarkerName(l.markerName);
                            setEditLabValue(l.resultValue);
                            setEditLabUnit(l.unit);
                          }}
                          className="p-1.5 rounded text-slate-500 hover:text-blue-400 hover:bg-slate-800 transition-colors"
                          title="Editar exame"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeletingItem({ type: "lab", id: l.id, name: `${l.markerName} (${l.resultValue})` })}
                          className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                          title="Excluir exame"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Add Lab */}
            <div className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 h-fit space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Registrar Biomarcador
              </h4>
              <form onSubmit={handleAddLab} className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Nome do Exame</label>
                  <input
                    type="text"
                    value={testName}
                    onChange={(e) => setTestName(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Marcador</label>
                  <input
                    type="text"
                    value={markerName}
                    onChange={(e) => setMarkerName(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Valor</label>
                    <input
                      type="number"
                      step="any"
                      value={resultValue}
                      onChange={(e) => setResultValue(Number(e.target.value))}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Unidade</label>
                    <input
                      type="text"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 font-mono"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-blue-950/50"
                >
                  Salvar Exame
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Edit Metric Modal */}
      {editingMetric && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-emerald-400" />
              Editar Medida Corporal
            </h3>
            <form onSubmit={handleSaveEditMetric} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Peso (kg)</label>
                <input
                  type="number"
                  step="0.1"
                  value={editWeight}
                  onChange={(e) => setEditWeight(Number(e.target.value))}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Gordura Corporal (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={editBf ?? ""}
                  onChange={(e) => setEditBf(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Notas</label>
                <input
                  type="text"
                  value={editMetricNotes}
                  onChange={(e) => setEditMetricNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingMetric(null)}
                  className="px-3 py-1.5 text-xs text-slate-300 bg-slate-800 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-500"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Symptom Modal */}
      {editingSymptom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-amber-400" />
              Editar Sintoma
            </h3>
            <form onSubmit={handleSaveEditSymptom} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Sintoma</label>
                <input
                  type="text"
                  value={editSymptomName}
                  onChange={(e) => setEditSymptomName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Gravidade: {editSeverity}/10</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={editSeverity}
                  onChange={(e) => setEditSeverity(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Gatilho</label>
                <input
                  type="text"
                  value={editSymptomTrigger}
                  onChange={(e) => setEditSymptomTrigger(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingSymptom(null)}
                  className="px-3 py-1.5 text-xs text-slate-300 bg-slate-800 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-500"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Lab Modal */}
      {editingLab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-blue-400" />
              Editar Exame
            </h3>
            <form onSubmit={handleSaveEditLab} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nome do Exame</label>
                <input
                  type="text"
                  value={editLabTestName}
                  onChange={(e) => setEditLabTestName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Marcador</label>
                <input
                  type="text"
                  value={editLabMarkerName}
                  onChange={(e) => setEditLabMarkerName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Valor</label>
                  <input
                    type="number"
                    step="any"
                    value={editLabValue}
                    onChange={(e) => setEditLabValue(Number(e.target.value))}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Unidade</label>
                  <input
                    type="text"
                    value={editLabUnit}
                    onChange={(e) => setEditLabUnit(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingLab(null)}
                  className="px-3 py-1.5 text-xs text-slate-300 bg-slate-800 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        isOpen={!!deletingItem}
        title="Excluir Registro de Saúde"
        message={`Deseja realmente remover o registro '${deletingItem?.name}'?`}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={executeDeleteItem}
        onCancel={() => setDeletingItem(null)}
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
