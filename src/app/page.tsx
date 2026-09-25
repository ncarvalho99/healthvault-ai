"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { SafetyBadge } from "@/components/ui/SafetyBadge";
import { ClinicalMarkdown } from "@/components/ui/ClinicalMarkdown";
import {
  Pill,
  Utensils,
  MessageSquare,
  Sparkles,
  Scale,
  Calendar,
  ArrowRight,
  Activity,
  PlusCircle,
} from "lucide-react";
import { recommendationOriginLabel } from "@/lib/recommendation-origin";

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    medications: any[];
    dietPlans: any[];
    conversations: any[];
    recommendations: any[];
    metrics: any[];
    events: any[];
    reminders: any[];
  }>({
    medications: [],
    dietPlans: [],
    conversations: [],
    recommendations: [],
    metrics: [],
    events: [],
    reminders: [],
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/medications?active=true").then((r) => r.json()),
      fetch("/api/diets").then((r) => r.json()),
      fetch("/api/conversations").then((r) => r.json()),
      fetch("/api/recommendations").then((r) => r.json()),
      fetch("/api/health/metrics").then((r) => r.json()),
      fetch("/api/timeline").then((r) => r.json()),
      fetch("/api/reminders").then((r) => r.json()).catch(() => ({ reminders: [] })),
    ])
      .then(([meds, diets, convs, recs, metrics, timeline, rems]) => {
        setData({
          medications: meds.medications || [],
          dietPlans: diets.dietPlans || [],
          conversations: convs.conversations || [],
          recommendations: recs.recommendations || [],
          metrics: metrics.metrics || [],
          events: timeline.events || [],
          reminders: rems.reminders || [],
        });
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load dashboard:", err);
        setLoading(false);
      });
  }, []);

  const latestRec = data.recommendations[0] || null;
  const latestConv = data.conversations[0] || null;
  const activeDiet = data.dietPlans[0] || null;
  const latestDietVer = activeDiet?.versions?.[0] || null;
  const latestMetric = data.metrics[0] || null;
  const nextReminder = data.reminders[0] || null;

  // Pending reminders come oldest first, so an overdue one must be labelled as overdue, not "Hoje"
  const daysUntilReminder = nextReminder
    ? (new Date(nextReminder.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    : null;
  const daysOverdue = daysUntilReminder !== null && daysUntilReminder <= -1 ? Math.floor(-daysUntilReminder) : 0;
  const displaySchedule =
    daysUntilReminder === null
      ? "--"
      : daysOverdue > 0
      ? `Atrasado há ${daysOverdue} ${daysOverdue === 1 ? "dia" : "dias"}`
      : daysUntilReminder <= 0
      ? "Hoje"
      : Math.ceil(daysUntilReminder) === 1
      ? "Amanhã"
      : `Em ${Math.ceil(daysUntilReminder)} dias`;
  const displayReason = nextReminder ? nextReminder.title : "Nenhuma revisão agendada";

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
      <Header
        title="Painel Geral de Saúde"
        subtitle="Visão consolidada de protocolos, dosagens, metas nutricionais e eventos recentes"
      />

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        {loading ? (
          <div className="py-20 text-center text-slate-400 text-sm">Carregando painel clínico...</div>
        ) : (
          <>
            {/* Top Stat Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Active Medications Stat */}
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                  <span>Medicamentos Ativos</span>
                  <Pill className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold text-slate-100 font-mono">
                  {data.medications.length}
                </div>
                <p className="text-[11px] text-slate-400">
                  {data.medications.map((m) => m.name).slice(0, 2).join(", ") || "Nenhum ativo"}
                </p>
              </div>

              {/* Current Calories Target */}
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                  <span>Alvo Calórico Diário</span>
                  <Utensils className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold text-amber-300 font-mono">
                  {latestDietVer?.targetCalories ? (
                    <>
                      {latestDietVer.targetCalories}{" "}
                      <span className="text-xs font-normal text-slate-400">kcal</span>
                    </>
                  ) : (
                    "--"
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  {latestDietVer
                    ? `Proteína: ${latestDietVer.targetProteinG}g • v${activeDiet?.currentVersion || 1}`
                    : "Nenhuma dieta configurada"}
                </p>
              </div>

              {/* Latest Weight */}
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                  <span>Peso Mais Recente</span>
                  <Scale className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-2xl font-bold text-blue-300 font-mono">
                  {latestMetric?.weightKg || "--"}{" "}
                  <span className="text-xs font-normal text-slate-400">kg</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Gordura corporal: {latestMetric?.bodyFatPct ? `${latestMetric.bodyFatPct}%` : "não informada"}
                </p>
              </div>

              {/* Upcoming Review */}
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                  <span>Próxima Revisão</span>
                  <Calendar className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-lg font-bold text-slate-100">
                  {displaySchedule}
                </div>
                <p className="text-[11px] text-slate-400">
                  {displayReason}
                </p>
              </div>
            </div>

            {/* Central Two Columns */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left 2 Cols: Latest Recommendation & Active Meds */}
              <div className="lg:col-span-2 space-y-6">
                {/* Latest Recommendation Snapshot */}
                <div className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2.5">
                      <Sparkles className="w-5 h-5 text-emerald-400" />
                      <div>
                        <h3 className="text-sm font-bold text-slate-100">
                          Recomendação Atual / Latest Recommendation
                        </h3>
                        <p className="text-xs text-slate-400">
                          {latestRec?.title || "Nenhum protocolo ativo"}
                        </p>
                      </div>
                    </div>
                    {latestRec && <SafetyBadge status={latestRec.status} sourceType={latestRec.sourceType} size="sm" />}
                  </div>

                  {latestRec ? (
                    <div className="space-y-3">
                      <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs space-y-2">
                        <div className="flex justify-between text-slate-400 font-mono text-[11px]">
                          <span>Versão Vigente: v{latestRec.currentVersion}</span>
                          <span>
                            Atualizado em:{" "}
                            {new Date(latestRec.updatedAt).toLocaleDateString("pt-BR")}
                          </span>
                        </div>
                        {latestRec.notes && (
                          <div className="max-h-48 overflow-y-auto pr-1">
                            <ClinicalMarkdown content={latestRec.notes} preview maxPreviewChars={280} />
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-slate-400">
                          Origem: {recommendationOriginLabel(latestRec.sourceType, latestRec.sourceName)}
                        </span>
                        <Link
                          href={`/recommendations`}
                          className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                        >
                          <span>Ver protocolo completo & Diffs</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic py-4">
                      Nenhuma recomendação registrada ainda.
                    </p>
                  )}
                </div>

                {/* Active Medications List */}
                <div className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                      <Pill className="w-5 h-5 text-emerald-400" />
                      <h3 className="text-sm font-bold text-slate-100">Medicamentos em Uso</h3>
                    </div>
                    <Link
                      href="/medications"
                      className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
                    >
                      Gerenciar
                    </Link>
                  </div>

                  <div className="space-y-2">
                    {data.medications.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">Nenhum medicamento ativo.</p>
                    ) : (
                      data.medications.map((med) => {
                        const ver = med.versions?.[0];
                        return (
                          <div
                            key={med.id}
                            className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-slate-100">
                                  {med.name}
                                </span>
                                {med.category && (
                                  <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">
                                    {med.category}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-400 mt-0.5">
                                {ver?.schedule || ver?.route || "Uso contínuo"}
                              </p>
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-bold font-mono text-emerald-400">
                                {ver?.doseValue} {ver?.doseUnit}
                              </span>
                              <span className="text-[11px] text-slate-400 block">
                                {ver?.frequency}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Right Col: Latest Conversation & Recent Changes */}
              <div className="space-y-6">
                {/* Latest Conversation Card */}
                <div className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-blue-400" />
                      <h3 className="text-sm font-bold text-slate-100">Última Conversa</h3>
                    </div>
                    <Link
                      href="/conversations"
                      className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                    >
                      Ver todas
                    </Link>
                  </div>

                  {latestConv ? (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-slate-200">{latestConv.title}</h4>
                      <p className="text-xs text-slate-400 line-clamp-3">
                        {latestConv.summary || "Histórico de conversa aberto para acompanhamento clínico."}
                      </p>
                      <Link
                        href={`/conversations/${latestConv.id}`}
                        className="w-full mt-2 py-2 px-3 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <span>Abrir Chat da Conversa</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-xs text-slate-500 mb-2">Nenhuma conversa criada.</p>
                      <Link
                        href="/conversations"
                        className="inline-flex items-center gap-1 text-xs text-emerald-400"
                      >
                        <PlusCircle className="w-3.5 h-3.5" /> Criar conversa
                      </Link>
                    </div>
                  )}
                </div>

                {/* Recent Clinical Events */}
                <div className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                      <Activity className="w-5 h-5 text-emerald-400" />
                      <h3 className="text-sm font-bold text-slate-100">O Que Mudou (Recent Changes)</h3>
                    </div>
                    <Link
                      href="/timeline"
                      className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
                    >
                      Linha do Tempo
                    </Link>
                  </div>

                  <div className="space-y-2.5">
                    {data.events.slice(0, 4).map((evt: any) => (
                      <div
                        key={evt.id}
                        className="text-xs p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/60 space-y-0.5"
                      >
                        <div className="flex items-center justify-between text-slate-400 text-[10px] font-mono">
                          <span>{evt.type}</span>
                          <span>{new Date(evt.date).toLocaleDateString("pt-BR")}</span>
                        </div>
                        <div className="font-medium text-slate-200">{evt.title}</div>
                        <div className="text-slate-400 text-[11px]">{evt.subtitle}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
