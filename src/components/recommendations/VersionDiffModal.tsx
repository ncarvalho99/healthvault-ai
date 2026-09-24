"use client";

import React, { useEffect, useState } from "react";
import { X, GitCommit, ArrowRight, Clock, User, AlertTriangle } from "lucide-react";
import { SafetyBadge } from "../ui/SafetyBadge";

interface VersionDiffModalProps {
  recommendationId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function VersionDiffModal({ recommendationId, isOpen, onClose }: VersionDiffModalProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ recommendationTitle: string; versions: any[] } | null>(null);

  useEffect(() => {
    if (!isOpen || !recommendationId) return;
    setLoading(true);
    fetch(`/api/recommendations/${recommendationId}/versions`)
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load versions:", err);
        setLoading(false);
      });
  }, [isOpen, recommendationId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div>
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <GitCommit className="w-5 h-5 text-emerald-400" />
              Histórico & Comparação de Versões
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {data?.recommendationTitle || "Rastreabilidade de Alterações Clínicas"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {loading ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              Carregando histórico de versões...
            </div>
          ) : !data || data.versions.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              Nenhuma versão encontrada para esta recomendação.
            </div>
          ) : (
            data.versions.map((ver: any) => (
              <div
                key={ver.id}
                className="p-5 rounded-xl border border-slate-800 bg-slate-950/40 space-y-4 hover:border-slate-700 transition-colors"
              >
                {/* Version Title & Badges */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono text-xs font-bold">
                      v{ver.versionNumber}
                    </span>
                    <SafetyBadge status={ver.status} size="sm" />
                    {ver.isInitial && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-950/50 text-blue-300 border border-blue-800/40">
                        Protocolo Inicial
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(ver.createdAt).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="flex items-center gap-1 font-medium text-slate-300">
                      <User className="w-3.5 h-3.5" />
                      {ver.actorName || ver.actorType}
                    </span>
                  </div>
                </div>

                {/* Change Reason Banner */}
                {ver.changeReason && (
                  <div className="text-xs bg-slate-900/90 border-l-2 border-emerald-500 p-2.5 rounded-r text-slate-300">
                    <strong className="text-slate-400">Motivo da alteração: </strong>
                    {ver.changeReason}
                  </div>
                )}

                {/* Diff Viewer (When not initial) */}
                {ver.diff && (
                  <div className="space-y-3 pt-1">
                    <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Modificações em relação à versão anterior:
                    </h5>

                    {/* Medication Diffs */}
                    {ver.diff.medications && ver.diff.medications.length > 0 && (
                      <div className="space-y-2">
                        {ver.diff.medications.map((mDiff: any, i: number) => (
                          <div
                            key={i}
                            className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-xs flex flex-col gap-1.5"
                          >
                            <div className="font-semibold text-slate-200 flex items-center justify-between">
                              <span>{mDiff.name}</span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                  mDiff.status === "added"
                                    ? "bg-emerald-950 text-emerald-400 border border-emerald-700/50"
                                    : mDiff.status === "adjusted"
                                    ? "bg-amber-950 text-amber-400 border border-amber-700/50"
                                    : "bg-rose-950 text-rose-400 border border-rose-700/50"
                                }`}
                              >
                                {mDiff.status === "added"
                                  ? "Adicionado"
                                  : mDiff.status === "adjusted"
                                  ? "Dosagem Ajustada"
                                  : "Removido"}
                              </span>
                            </div>

                            {mDiff.changes.map((c: any, ci: number) => (
                              <div key={ci} className="flex items-center gap-2 text-slate-300 font-mono text-[11px]">
                                <span className="text-slate-400 font-sans">{c.label}:</span>
                                {c.oldValue && (
                                  <span className="line-through text-rose-400/90 bg-rose-950/40 px-1.5 py-0.5 rounded">
                                    {c.oldValue}
                                  </span>
                                )}
                                <ArrowRight className="w-3 h-3 text-slate-500" />
                                <span className="text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded font-bold">
                                  {c.newValue}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Nutrition Diffs */}
                    {ver.diff.nutrition && ver.diff.nutrition.length > 0 && (
                      <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-xs space-y-1.5">
                        <span className="font-semibold text-slate-300">Alterações Nutricionais:</span>
                        <div className="grid grid-cols-2 gap-2">
                          {ver.diff.nutrition.map((nDiff: any, ni: number) => (
                            <div key={ni} className="flex items-center gap-2 text-[11px] font-mono">
                              <span className="text-slate-400 font-sans">{nDiff.label}:</span>
                              <span className="line-through text-slate-500">{nDiff.oldValue}</span>
                              <ArrowRight className="w-3 h-3 text-slate-500" />
                              <span className="text-emerald-400 font-bold">{nDiff.newValue}</span>
                              <span
                                className={`text-[10px] font-bold ${
                                  nDiff.delta > 0 ? "text-emerald-400" : "text-amber-400"
                                }`}
                              >
                                ({nDiff.delta > 0 ? `+${nDiff.delta}` : nDiff.delta})
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* If Initial Version, show snapshot items */}
                {ver.isInitial && ver.summarySnapshot && (
                  <div className="text-xs text-slate-400 bg-slate-900/40 p-3 rounded-lg border border-slate-800/80">
                    <span className="font-semibold text-slate-300 block mb-1">Parâmetros Iniciais:</span>
                    <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap">
                      {JSON.stringify(ver.summarySnapshot, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5 text-amber-400/90">
            <AlertTriangle className="w-4 h-4" />
            <span>Versões históricas são gravadas de forma imutável para auditoria.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
