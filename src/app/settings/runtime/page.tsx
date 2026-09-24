"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import {
  Activity,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Zap,
  Server,
  Terminal,
  RefreshCw,
} from "lucide-react";

export default function RuntimeStatusPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [testingModel, setTestingModel] = useState<string | null>(null);

  const loadStatus = () => {
    setLoading(true);
    fetch("/api/ai/runtime/status")
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load runtime status:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleTestCapability = async (integrationId: string, modelExternalId: string) => {
    setTestingModel(modelExternalId);
    try {
      const res = await fetch("/api/ai/capabilities/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId, modelExternalId }),
      });
      const resData = await res.json();
      if (res.ok) {
        alert(
          resData.supportsTools
            ? `✓ Sucesso! O combo '${modelExternalId}' executou tool calling com sucesso em ${resData.latencyMs}ms.`
            : `⚠ O combo '${modelExternalId}' respondeu mas não chamou a ferramenta (${resData.latencyMs}ms).`
        );
        loadStatus();
      } else {
        alert("Erro no handshake de capabilities: " + resData.error);
      }
    } catch (err: any) {
      alert("Falha de rede: " + err.message);
    } finally {
      setTestingModel(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
      <Header
        title="Status do Agent Tool Runtime"
        subtitle="Auditoria de execução de ferramentas, capabilities dos modelos e saúde operacional"
      />

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        {/* Navigation Tabs between Integrations and Runtime */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex gap-2">
            <Link
              href="/settings/integrations"
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200"
            >
              Conexões OmniRoute
            </Link>
            <span className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/20 text-emerald-300 border border-emerald-500/30">
              Runtime & Capabilities
            </span>
          </div>

          <button
            onClick={loadStatus}
            className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Atualizar</span>
          </button>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400 text-xs">Carregando métricas de runtime...</div>
        ) : !data ? (
          <div className="py-20 text-center text-rose-400 text-xs">Erro ao carregar dados de runtime.</div>
        ) : (
          <>
            {/* Top Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-1">
                <span className="text-[11px] text-slate-400 block">Total Tool Calls</span>
                <span className="text-xl font-bold font-mono text-slate-100">{data.stats.totalExecutions}</span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-1">
                <span className="text-[11px] text-slate-400 block">Aguardando Aprovação</span>
                <span className="text-xl font-bold font-mono text-amber-400">{data.stats.pendingApprovals}</span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-1">
                <span className="text-[11px] text-slate-400 block">Execuções com Sucesso</span>
                <span className="text-xl font-bold font-mono text-emerald-400">{data.stats.executedCount}</span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-1">
                <span className="text-[11px] text-slate-400 block">Propostas Rejeitadas</span>
                <span className="text-xl font-bold font-mono text-slate-400">{data.stats.rejectedCount}</span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-1">
                <span className="text-[11px] text-slate-400 block">Falhas / Erros</span>
                <span className="text-xl font-bold font-mono text-rose-400">{data.stats.failedCount}</span>
              </div>
            </div>

            {/* Combos & Capability Handshake Section */}
            <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    Combos do Usuário & Capability Handshake
                  </h3>
                  <p className="text-xs text-slate-400">
                    Verificação ativa se o combo executa tool calling através da ferramenta inofensiva <code>healthvault_ping</code>.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.integrations?.[0]?.models?.map((m: any) => (
                  <div
                    key={m.id}
                    className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex flex-col justify-between space-y-3"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs font-mono text-slate-100">{m.externalId}</span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 text-[10px] font-mono border border-emerald-800/40">
                          combo
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 block mt-1">
                        Tool Calling:{" "}
                        <strong className={m.supportsTools ? "text-emerald-400" : "text-amber-400"}>
                          {m.supportsTools ? "✓ Suportado" : "Não testado"}
                        </strong>
                      </span>
                    </div>

                    <button
                      onClick={() => handleTestCapability(data.integrations[0].id, m.externalId)}
                      disabled={testingModel === m.externalId}
                      className="w-full py-1.5 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Zap className={`w-3.5 h-3.5 ${testingModel === m.externalId ? "animate-spin text-amber-400" : "text-emerald-400"}`} />
                      <span>{testingModel === m.externalId ? "Testando Handshake..." : "Testar Tool Calling"}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Registered Tools in HealthVault Host */}
            <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Catálogo de Ferramentas Ativas no Host ({data.toolsCount})
                  </h3>
                  <p className="text-xs text-slate-400">
                    O modelo conhece apenas estas ferramentas estruturadas. Não há exposição de rotas REST internas.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
                {data.tools.map((t: any) => (
                  <div
                    key={t.name}
                    className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/60 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-200 text-[11px]">{t.name}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold uppercase ${
                          t.access === "write"
                            ? "bg-amber-950 text-amber-400 border border-amber-800"
                            : "bg-blue-950 text-blue-400 border border-blue-800"
                        }`}
                      >
                        {t.access}
                      </span>
                    </div>
                    <p className="text-slate-400 text-[10px] line-clamp-2 leading-relaxed">{t.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Tool Executions Log */}
            <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-4">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                Histórico Recente de Execuções de Ferramentas
              </h3>

              {data.executions.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-4">Nenhuma ferramenta executada recentemente.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase font-mono text-[10px]">
                      <tr>
                        <th className="p-2.5">Data / Hora</th>
                        <th className="p-2.5">Ferramenta</th>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5">Conversa</th>
                        <th className="p-2.5">Argumentos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 text-slate-300 font-mono text-[11px]">
                      {data.executions.map((e: any) => (
                        <tr key={e.id} className="hover:bg-slate-850/40">
                          <td className="p-2.5 whitespace-nowrap text-slate-400">
                            {new Date(e.startedAt).toLocaleString("pt-BR")}
                          </td>
                          <td className="p-2.5 font-bold text-emerald-400">{e.toolName}</td>
                          <td className="p-2.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                e.status === "EXECUTED"
                                  ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                                  : e.status === "PENDING_APPROVAL"
                                  ? "bg-amber-950 text-amber-400 border border-amber-800"
                                  : "bg-rose-950 text-rose-400 border border-rose-800"
                              }`}
                            >
                              {e.status}
                            </span>
                          </td>
                          <td className="p-2.5 font-sans text-slate-300">{e.conversation?.title || "-"}</td>
                          <td className="p-2.5 max-w-xs truncate text-slate-400">
                            {JSON.stringify(e.inputJson)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
