"use client";

import React, { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toast } from "@/components/ui/Toast";
import {
  Sparkles,
  Server,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldAlert,
  Save,
  Key,
  Globe,
  Sliders,
  Trash2,
} from "lucide-react";

export default function IntegrationsSettingsPage() {
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [policy, setPolicy] = useState<any>({
    recommendations: "AUTO_APPLY",
    nutrition: "AUTO_APPLY",
    metrics: "AUTO_APPLY",
    symptoms: "AUTO_APPLY",
    labs: "REVIEW_FIRST",
    medications: "REVIEW_FIRST",
    dosageChanges: "REVIEW_FIRST",
  });
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Toast notification state
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // New Integration Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("OmniRoute");
  const [baseUrl, setBaseUrl] = useState("http://localhost:20128/v1");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("demigod-flash");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Active testing and sync state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deletingIntegration, setDeletingIntegration] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [testFeedback, setTestFeedback] = useState<Record<string, any>>({});

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  };

  const loadData = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/ai/integrations").then((r) => r.json()),
      fetch("/api/ai/policy").then((r) => r.json()),
    ])
      .then(([intData, polData]) => {
        setIntegrations(intData.integrations || []);
        if (polData.policy) setPolicy(polData.policy);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load integrations/policy:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !baseUrl || !apiKey || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/ai/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          baseUrl,
          apiKey,
          defaultModel,
        }),
      });

      if (res.ok) {
        setIsModalOpen(false);
        setApiKey("");
        showToast("Conexão OmniRoute cadastrada e testada com sucesso!");
        loadData();
      } else {
        const err = await res.json();
        showToast(err.error || "Erro ao salvar integração.", "error");
      }
    } catch (err: any) {
      showToast("Falha ao comunicar com o servidor: " + err.message, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const executeDeleteIntegration = async () => {
    if (!deletingIntegration) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/ai/integrations/${deletingIntegration.id}`, { method: "DELETE" });
      if (res.ok) {
        showToast(`Conexão '${deletingIntegration.name}' removida.`);
        setDeletingIntegration(null);
        loadData();
      } else {
        showToast("Erro ao excluir conexão.", "error");
      }
    } catch (err: any) {
      showToast("Falha ao excluir: " + err.message, "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/ai/integrations/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestFeedback((prev) => ({ ...prev, [id]: data.testResult }));
      if (data.testResult?.success) {
        showToast(`Conexão validada em ${data.testResult.latencyMs}ms!`);
      } else {
        showToast(`Falha no teste: ${data.testResult?.error}`, "error");
      }
      loadData();
    } catch (err: any) {
      setTestFeedback((prev) => ({ ...prev, [id]: { success: false, error: err.message } }));
      showToast("Falha ao testar conexão.", "error");
    } finally {
      setTestingId(null);
    }
  };

  const handleSyncModels = async (id: string) => {
    setSyncingId(id);
    try {
      const res = await fetch(`/api/ai/integrations/${id}/sync`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        showToast(`Sincronização concluída! ${data.count} modelos/combos catalogados.`);
        loadData();
      } else {
        showToast(data.error || "Falha na sincronização.", "error");
      }
    } catch (err: any) {
      showToast("Erro ao sincronizar modelos: " + err.message, "error");
    } finally {
      setSyncingId(null);
    }
  };

  const handleUpdateDefaultModel = async (integrationId: string, modelName: string) => {
    try {
      const res = await fetch(`/api/ai/integrations/${integrationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultModel: modelName, defaultCombo: modelName }),
      });
      if (res.ok) {
        showToast(`Modelo padrão alterado para '${modelName}'.`);
        loadData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    try {
      const res = await fetch("/api/ai/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });

      if (res.ok) {
        showToast("Diretrizes de escrita atualizadas com sucesso!");
      } else {
        showToast("Erro ao salvar política.", "error");
      }
    } catch (err: any) {
      showToast("Erro: " + err.message, "error");
    } finally {
      setSavingPolicy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
      <Header
        title="Configurações de IA & OmniRoute"
        subtitle="Gerenciamento de conexões com gateways de IA, modelos e políticas de execução de ferramentas"
      />

      <div className="flex-1 p-6 space-y-8 overflow-y-auto">
        {/* Top Notice */}
        <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-300 space-y-1">
            <span className="font-semibold text-slate-100 block">Arquitetura de Segurança Zero-Exposition</span>
            <p>
              As chaves de API são armazenadas com criptografia autenticada <strong>AES-256-GCM</strong> e nunca são expostas ao frontend.
              Todas as requisições ao OmniRoute partem exclusivamente do backend do HealthVault, preservando isolamento e auditoria completa.
            </p>
          </div>
        </div>

        {/* Section 1: AI Integrations */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-400" />
                Gateways de IA Conectados
              </h3>
              <p className="text-xs text-slate-400">
                Endereço base do OmniRoute ou servidor compatível com OpenAI.
              </p>
            </div>

            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-950/50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Conectar OmniRoute</span>
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12 text-slate-400 text-xs">Carregando integrações...</div>
          ) : integrations.length === 0 ? (
            <div className="p-8 rounded-xl bg-slate-900/40 border border-slate-800 text-center space-y-3">
              <Server className="w-10 h-10 mx-auto text-slate-700" />
              <div className="text-xs text-slate-400">
                Nenhum gateway configurado. Adicione sua instância do OmniRoute para habilitar o agente de saúde no chat.
              </div>
              <button
                onClick={() => setIsModalOpen(true)}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold"
              >
                Configurar Primeiro Endpoint
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {integrations.map((it) => {
                const feedback = testFeedback[it.id];

                return (
                  <div
                    key={it.id}
                    className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-100">{it.name}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                            {it.providerType}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                          <Globe className="w-3 h-3 text-slate-500" />
                          {it.baseUrl}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {it.connectionStatus === "CONNECTED" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-600/40 text-emerald-400 text-xs font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Conectado</span>
                          </span>
                        ) : it.connectionStatus === "ERROR" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-950/80 border border-rose-600/40 text-rose-400 text-xs font-medium">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Falha na Conexão</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/80 border border-amber-600/40 text-amber-400 text-xs font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Não Testado</span>
                          </span>
                        )}

                        {/* Delete Button */}
                        <button
                          onClick={() => setDeletingIntegration({ id: it.id, name: it.name })}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-800/40 transition-colors"
                          title="Excluir conexão"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
                        <span className="text-slate-400 block mb-1">Chave de Acesso (API Key)</span>
                        <span className="font-mono text-slate-300 flex items-center gap-1.5">
                          <Key className="w-3 h-3 text-slate-500" />
                          {it.maskedApiKey}
                        </span>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
                        <span className="text-slate-400 block mb-1">Modelo / Combo Selecionado</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            defaultValue={it.defaultCombo || it.defaultModel || "demigod-flash"}
                            onBlur={(e) => handleUpdateDefaultModel(it.id, e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleUpdateDefaultModel(it.id, (e.target as any).value)}
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-emerald-400 w-full focus:outline-none focus:border-emerald-500"
                            placeholder="ex: exploit, demigod-flash"
                          />
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
                        <span className="text-slate-400 block mb-1">Catálogo de Modelos</span>
                        <span className="text-slate-300 font-semibold">
                          {it._count?.models || 0} modelos catalogados
                        </span>
                      </div>
                    </div>

                    {/* Test Feedback Notice */}
                    {feedback && (
                      <div
                        className={`p-3 rounded-lg text-xs flex items-center justify-between ${
                          feedback.success
                            ? "bg-emerald-950/50 border border-emerald-800/50 text-emerald-300"
                            : "bg-rose-950/50 border border-rose-800/50 text-rose-300"
                        }`}
                      >
                        <span>
                          {feedback.success
                            ? `✓ Conexão validada com sucesso em ${feedback.latencyMs}ms (${feedback.modelsCount} modelos reportados).`
                            : `✕ Erro: ${feedback.error} (${feedback.latencyMs}ms)`}
                        </span>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        onClick={() => handleTestConnection(it.id)}
                        disabled={testingId === it.id}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${testingId === it.id ? "animate-spin" : ""}`} />
                        <span>Testar Conexão</span>
                      </button>

                      <button
                        onClick={() => handleSyncModels(it.id)}
                        disabled={syncingId === it.id}
                        className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 disabled:opacity-50 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${syncingId === it.id ? "animate-spin" : ""}`} />
                        <span>Sincronizar Modelos</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 2: AI Write Policy */}
        <div className="p-6 rounded-xl bg-slate-900/70 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                Política de Escrita da IA (AI Write Policies)
              </h3>
              <p className="text-xs text-slate-400">
                Determine se alterações propostas pelo agente serão aplicadas automaticamente ou exigirão confirmação explícita no chat.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-200 block">Recomendações Clínicas</span>
                <span className="text-slate-500 text-[11px]">Criação e atualização de snapshots</span>
              </div>
              <select
                value={policy.recommendations}
                onChange={(e) => setPolicy({ ...policy, recommendations: e.target.value })}
                className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="AUTO_APPLY">Aplicar Automaticamente</option>
                <option value="REVIEW_FIRST">Exigir Confirmação</option>
              </select>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-200 block">Metas Nutricionais & Dieta</span>
                <span className="text-slate-500 text-[11px]">Calorias e macronutrientes</span>
              </div>
              <select
                value={policy.nutrition}
                onChange={(e) => setPolicy({ ...policy, nutrition: e.target.value })}
                className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="AUTO_APPLY">Aplicar Automaticamente</option>
                <option value="REVIEW_FIRST">Exigir Confirmação</option>
              </select>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-200 block">Medidas & Peso Corporal</span>
                <span className="text-slate-500 text-[11px]">Pesagens e percentual de gordura</span>
              </div>
              <select
                value={policy.metrics}
                onChange={(e) => setPolicy({ ...policy, metrics: e.target.value })}
                className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="AUTO_APPLY">Aplicar Automaticamente</option>
                <option value="REVIEW_FIRST">Exigir Confirmação</option>
              </select>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-200 block">Sintomas & Reações</span>
                <span className="text-slate-500 text-[11px]">Escala de dor e desconfortos</span>
              </div>
              <select
                value={policy.symptoms}
                onChange={(e) => setPolicy({ ...policy, symptoms: e.target.value })}
                className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="AUTO_APPLY">Aplicar Automaticamente</option>
                <option value="REVIEW_FIRST">Exigir Confirmação</option>
              </select>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-200 block">Exames Laboratoriais</span>
                <span className="text-slate-500 text-[11px]">Resultados e biomarcadores</span>
              </div>
              <select
                value={policy.labs}
                onChange={(e) => setPolicy({ ...policy, labs: e.target.value })}
                className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="REVIEW_FIRST">Exigir Confirmação</option>
                <option value="AUTO_APPLY">Aplicar Automaticamente</option>
              </select>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-200 block">Cadastro de Medicamentos</span>
                <span className="text-slate-500 text-[11px]">Iniciação de novas substâncias</span>
              </div>
              <select
                value={policy.medications}
                onChange={(e) => setPolicy({ ...policy, medications: e.target.value })}
                className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="REVIEW_FIRST">Exigir Confirmação</option>
                <option value="AUTO_APPLY">Aplicar Automaticamente</option>
              </select>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between md:col-span-2">
              <div>
                <span className="font-semibold text-slate-200 block">Ajustes de Dosagem</span>
                <span className="text-slate-500 text-[11px]">Aumento, redução ou alteração de frequência posológica</span>
              </div>
              <select
                value={policy.dosageChanges}
                onChange={(e) => setPolicy({ ...policy, dosageChanges: e.target.value })}
                className="bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="REVIEW_FIRST">Exigir Confirmação</option>
                <option value="AUTO_APPLY">Aplicar Automaticamente</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-3">
            <button
              onClick={handleSavePolicy}
              disabled={savingPolicy}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-950/50 transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{savingPolicy ? "Salvando..." : "Salvar Diretrizes de Escrita"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Custom Confirm Dialog for Deleting Integration */}
      <ConfirmDialog
        isOpen={!!deletingIntegration}
        title="Excluir Conexão OmniRoute"
        message={`Deseja realmente excluir a conexão '${deletingIntegration?.name}'? Os modelos associados e registros desta conexão serão removidos.`}
        confirmText="Excluir Conexão"
        cancelText="Cancelar"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={executeDeleteIntegration}
        onCancel={() => setDeletingIntegration(null)}
      />

      {/* Toast Notification */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {/* Modal: Add AI Integration */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-400" />
                Cadastrar Conexão OmniRoute
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateIntegration} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Nome da Conexão
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Ex: OmniRoute Homelab"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Base URL do Endpoint
                </label>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  required
                  placeholder="http://localhost:20128/v1 ou https://omniroute.example.com/v1"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Pode terminar em /v1 ou não; as rotas /models e /chat/completions serão normalizadas automaticamente.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  API Key / Secret Token
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required
                  placeholder="••••••••••••••••••••••••"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
                <span className="text-[11px] text-emerald-400/80 mt-1 block">
                  A chave é protegida com chave AES-256-GCM e nunca enviada ao navegador.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Modelo / Combo Padrão
                </label>
                <input
                  type="text"
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  placeholder="exploit ou demigod-flash"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-300 bg-slate-800 rounded-xl hover:bg-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl shadow-lg shadow-emerald-950/50"
                >
                  {isSubmitting ? "Testando e Salvando..." : "Salvar e Testar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
