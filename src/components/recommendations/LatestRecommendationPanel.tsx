"use client";

import React, { useState } from "react";
import { Pill, Utensils, History, Sparkles, ChevronUp, ChevronDown } from "lucide-react";
import { SafetyBadge } from "../ui/SafetyBadge";
import { VersionDiffModal } from "./VersionDiffModal";

interface LatestRecommendationPanelProps {
  recommendation: any;
}

export function LatestRecommendationPanel({ recommendation }: LatestRecommendationPanelProps) {
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!recommendation) {
    return null;
  }

  const latestVersion = recommendation.versions?.[0] || null;
  const snapshot = (latestVersion?.summarySnapshot as any) || {};
  const medications = recommendation.medications || [];

  return (
    <>
      <div className="border-t border-slate-800 bg-slate-900/95 backdrop-blur-md shadow-lg transition-all duration-200">
        {/* Panel Header */}
        <div className="px-5 py-3 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Estado Atual / Latest Recommendation
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-600/40 text-emerald-400 font-mono text-[10px] font-bold">
                  v{recommendation.currentVersion}
                </span>
                <SafetyBadge status={recommendation.status} sourceType={recommendation.sourceType} size="sm" />
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {recommendation.title} • Atualizado em{" "}
                {new Date(recommendation.updatedAt).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsDiffModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-colors"
            >
              <History className="w-3.5 h-3.5" />
              <span>Ver Histórico & Diffs</span>
            </button>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title={isCollapsed ? "Expandir" : "Minimizar"}
            >
              {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Panel Content (Medications & Nutrition Snapshot) */}
        {!isCollapsed && (
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Medications Column */}
            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-slate-300 font-semibold border-b border-slate-800/80 pb-1.5">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <Pill className="w-3.5 h-3.5" />
                  Medicamentos Ativos
                </span>
                <span className="text-[11px] text-slate-400">{medications.length} prescritos/sugeridos</span>
              </div>

              {medications.length === 0 ? (
                <p className="text-slate-500 italic py-2">Nenhum medicamento ativo associado.</p>
              ) : (
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {medications.map((med: any) => {
                    const ver = med.versions?.[0];
                    return (
                      <div
                        key={med.id}
                        className="flex items-center justify-between p-2 rounded bg-slate-900/80 border border-slate-800/60 text-slate-200"
                      >
                        <div>
                          <span className="font-medium text-slate-100">{med.name}</span>
                          <span className="text-slate-400 text-[11px] ml-1.5">
                            ({med.form || "Forma padrão"})
                          </span>
                        </div>
                        <div className="text-right font-mono">
                          <span className="text-emerald-400 font-bold">
                            {ver?.doseValue} {ver?.doseUnit}
                          </span>
                          <span className="text-slate-400 text-[10px] block font-sans">
                            {ver?.frequency || "1x/dia"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Nutrition / Macros Column */}
            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-slate-300 font-semibold border-b border-slate-800/80 pb-1.5">
                <span className="flex items-center gap-1.5 text-amber-400">
                  <Utensils className="w-3.5 h-3.5" />
                  Alvos Nutricionais Atuais
                </span>
                <span className="text-[11px] text-slate-400">Metas Diárias</span>
              </div>

              {snapshot.nutrition ? (
                <div className="grid grid-cols-4 gap-2 pt-1 text-center font-mono">
                  <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block font-sans">Calorias</span>
                    <span className="text-amber-300 font-bold text-sm">
                      {snapshot.nutrition.calories || 2100}
                    </span>
                    <span className="text-[9px] text-slate-500 block">kcal</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block font-sans">Proteína</span>
                    <span className="text-emerald-400 font-bold text-sm">
                      {snapshot.nutrition.protein_g || 190}g
                    </span>
                    <span className="text-[9px] text-slate-500 block">meta</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block font-sans">Carboidratos</span>
                    <span className="text-blue-400 font-bold text-sm">
                      {snapshot.nutrition.carbs_g || 180}g
                    </span>
                    <span className="text-[9px] text-slate-500 block">energia</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block font-sans">Gorduras</span>
                    <span className="text-purple-400 font-bold text-sm">
                      {snapshot.nutrition.fat_g || 70}g
                    </span>
                    <span className="text-[9px] text-slate-500 block">lipídios</span>
                  </div>
                </div>
              ) : (
                <p className="text-slate-500 italic py-2">Metas nutricionais não parametrizadas.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Version History & Diff Modal */}
      <VersionDiffModal
        recommendationId={recommendation.id}
        isOpen={isDiffModalOpen}
        onClose={() => setIsDiffModalOpen(false)}
      />
    </>
  );
}
