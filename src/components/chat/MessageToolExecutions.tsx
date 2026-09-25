"use client";

import React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Database,
  ArrowRight,
  Check,
  X,
} from "lucide-react";

export const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  healthvault_list_medications: "Medicamentos",
  healthvault_get_medication: "Medicamento",
  healthvault_get_medication_history: "Histórico de Medicamentos",
  healthvault_create_medication: "Medicamento",
  healthvault_update_medication: "Ajuste de Medicamento",
  healthvault_stop_medication: "Encerramento de Medicamento",
  healthvault_get_current_diet: "Dieta",
  healthvault_get_diet_history: "Histórico de Dieta",
  healthvault_create_diet: "Plano Nutricional",
  healthvault_update_diet: "Dieta",
  healthvault_list_foods: "Alimentos",
  healthvault_create_food: "Alimento",
  healthvault_get_body_metrics: "Métricas Corporais",
  healthvault_add_body_metric: "Métrica Corporal",
  healthvault_list_symptoms: "Sintomas",
  healthvault_add_symptom: "Sintoma",
  healthvault_list_lab_results: "Exames Laboratoriais",
  healthvault_add_lab_result: "Resultado de Exame",
  healthvault_create_reminder: "Lembrete Clínico",
  healthvault_get_timeline: "Linha do Tempo",
  healthvault_get_context: "Contexto Clínico",
  healthvault_search: "Pesquisa no Prontuário",
  healthvault_list_recommendations: "Recomendações",
  healthvault_get_recommendation: "Recomendação",
  healthvault_create_recommendation: "Recomendação",
  healthvault_update_recommendation: "Ajuste de Recomendação",
};

export function getFriendlyToolName(toolName: string): string {
  if (TOOL_FRIENDLY_NAMES[toolName]) return TOOL_FRIENDLY_NAMES[toolName];
  const cleaned = toolName.replace(/^healthvault_/, "").replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function isReadTool(toolName: string): boolean {
  if (toolName.startsWith("healthvault_get_") || toolName.startsWith("healthvault_list_") || toolName === "healthvault_search") {
    return true;
  }
  return false;
}

interface MessageToolExecutionsProps {
  executions: any[];
  onApprove?: (executionId: string, action: "approve" | "reject") => void;
  resolvingExecId?: string | null;
}

export function MessageToolExecutions({
  executions,
  onApprove,
  resolvingExecId,
}: MessageToolExecutionsProps) {
  if (!executions || executions.length === 0) return null;

  // Filter out internal operational ping tools from user view
  const visibleExecutions = executions.filter((e) => e.toolName !== "healthvault_ping");
  if (visibleExecutions.length === 0) return null;

  // Separate read tools from write/action tools
  const readTools: any[] = [];
  const writeTools: any[] = [];

  for (const te of visibleExecutions) {
    if (isReadTool(te.toolName)) {
      readTools.push(te);
    } else {
      writeTools.push(te);
    }
  }

  // Unique friendly names for read tools
  const readFriendlyNames = Array.from(
    new Set(readTools.map((t) => getFriendlyToolName(t.toolName)))
  );

  return (
    <div className="mt-3 space-y-2 pt-2 border-t border-slate-800/60">
      {/* Read Tools: Quiet, compact indicator without spamming green success cards */}
      {readFriendlyNames.length > 0 && (
        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 py-1 px-2 rounded-lg bg-slate-950/40 border border-slate-800/50">
          <Database className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>Consultado no HealthVault:</span>
          <span className="text-slate-300 font-medium">{readFriendlyNames.join(", ")}</span>
        </div>
      )}

      {/* Write Tools: Distinct cards for actions, approvals, and mutations */}
      {writeTools.map((te, idx) => {
        const out = te.output || {};
        const isPending = out.requires_approval;
        const wasResolved = out.resolvedAction;
        const friendlyName = getFriendlyToolName(te.toolName);

        if (isPending && !wasResolved) {
          /* Card: Requires Manual Approval */
          return (
            <div
              key={idx}
              className="p-3.5 rounded-xl bg-amber-950/70 border border-amber-600/60 shadow-lg space-y-2.5 text-xs animate-in fade-in"
            >
              <div className="flex items-center gap-2 text-amber-300 font-bold uppercase tracking-wider text-[11px]">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Ação Requer Aprovação Clínica</span>
              </div>

              <p className="text-slate-200">
                {out.message || `A IA propôs atualizar ${friendlyName}.`}
              </p>

              {out.proposal && (
                <div className="p-2 rounded bg-slate-950/90 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto">
                  {JSON.stringify(out.proposal, null, 2)}
                </div>
              )}

              {onApprove && out.execution_id && (
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => onApprove(out.execution_id, "reject")}
                    disabled={resolvingExecId === out.execution_id}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                  >
                    Rejeitar
                  </button>
                  <button
                    onClick={() => onApprove(out.execution_id, "approve")}
                    disabled={resolvingExecId === out.execution_id}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 shadow-md shadow-emerald-950/50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Aprovar & Gravar</span>
                  </button>
                </div>
              )}
            </div>
          );
        }

        if (wasResolved === "reject") {
          return (
            <div
              key={idx}
              className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 flex items-center gap-2"
            >
              <XCircle className="w-4 h-4 text-slate-400 shrink-0" />
              <span>Ação rejeitada: {friendlyName}</span>
            </div>
          );
        }

        if (wasResolved === "approve" || out.success) {
          /* Card: Mutation executed successfully */
          return (
            <div
              key={idx}
              className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-700/50 text-xs text-emerald-200 flex items-center justify-between gap-3 animate-in fade-in"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="truncate">
                  <span className="font-semibold block text-slate-100 truncate">
                    HealthVault Atualizado: {friendlyName}
                  </span>
                  {out.data?.version && (
                    <span className="text-[11px] text-emerald-300 font-mono">
                      Versão v{out.data.version} gravada com rastreabilidade clínica.
                    </span>
                  )}
                </div>
              </div>

              {out.data?.entity === "diet" && (
                <Link
                  href="/diet"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-900/60 px-2.5 py-1 rounded-lg shrink-0"
                >
                  Ver Dieta <ArrowRight className="w-3 h-3" />
                </Link>
              )}

              {out.data?.entity === "medication" && (
                <Link
                  href="/medications"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-900/60 px-2.5 py-1 rounded-lg shrink-0"
                >
                  Ver Meds <ArrowRight className="w-3 h-3" />
                </Link>
              )}

              {out.data?.entity === "recommendation" && (
                <Link
                  href="/recommendations"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-900/60 px-2.5 py-1 rounded-lg shrink-0"
                >
                  Ver Protocolo <ArrowRight className="w-3 h-3" />
                </Link>
              )}

              {out.data?.entity === "metric" && (
                <Link
                  href="/health"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-900/60 px-2.5 py-1 rounded-lg shrink-0"
                >
                  Ver Métricas <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          );
        }

        /* Error state */
        return (
          <div
            key={idx}
            className="p-3 rounded-xl bg-rose-950/60 border border-rose-800/60 text-xs text-rose-300 flex items-center gap-2"
          >
            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>Falha ao atualizar {friendlyName}: {out.error?.message || "Erro desconhecido"}</span>
          </div>
        );
      })}
    </div>
  );
}
