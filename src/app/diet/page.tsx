"use client";

import React, { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toast } from "@/components/ui/Toast";
import { Utensils, Plus, History, Flame, Apple, Clock, ArrowRight, Trash2 } from "lucide-react";

export default function DietPage() {
  const [dietPlans, setDietPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isNewPlanOpen, setIsNewPlanOpen] = useState(false);

  // Deletion modal state
  const [deletingPlan, setDeletingPlan] = useState<{ id: string; title: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // New Diet Plan Form
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [calories, setCalories] = useState<number | string>("");
  const [protein, setProtein] = useState<number | string>("");
  const [carbs, setCarbs] = useState<number | string>("");
  const [fat, setFat] = useState<number | string>("");

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  };

  const loadDiets = () => {
    setLoading(true);
    fetch("/api/diets")
      .then((res) => res.json())
      .then((data) => {
        setDietPlans(data.dietPlans || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load diets:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadDiets();
  }, []);

  const handleCreateDiet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      const res = await fetch("/api/diets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          goal,
          targetCalories: Number(calories),
          targetProteinG: Number(protein),
          targetCarbsG: Number(carbs),
          targetFatG: Number(fat),
          changeReason: "Definição do plano alimentar inicial",
        }),
      });

      if (res.ok) {
        setIsNewPlanOpen(false);
        setTitle("");
        showToast("Plano alimentar criado com sucesso!");
        loadDiets();
      } else {
        showToast("Erro ao criar plano alimentar.", "error");
      }
    } catch (err: any) {
      showToast("Falha: " + err.message, "error");
    }
  };

  const executeDeletePlan = async () => {
    if (!deletingPlan) return;
    setIsDeleting(true);

    try {
      const res = await fetch(`/api/diets/${deletingPlan.id}`, { method: "DELETE" });
      if (res.ok) {
        showToast(`Plano alimentar '${deletingPlan.title}' excluído.`);
        setDeletingPlan(null);
        loadDiets();
      } else {
        showToast("Erro ao excluir plano alimentar.", "error");
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
        title="Nutrição & Planos Alimentares"
        subtitle="Versionamento de macros, alvos calóricos e divisão de refeições"
      />

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        <div className="flex items-center justify-between bg-slate-900/60 p-4 rounded-xl border border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-100">Planos Nutricionais Vigentes</h3>
            <p className="text-xs text-slate-400">
              Modificações nas metas de macros e calorias preservam as versões anteriores para acompanhamento metabólico.
            </p>
          </div>

          <button
            onClick={() => setIsNewPlanOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-950/50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Plano Alimentar</span>
          </button>
        </div>

        {loading ? (
          <div className="text-center py-20 text-slate-400 text-sm">Carregando dietas...</div>
        ) : dietPlans.length === 0 ? (
          <div className="text-center py-20 text-slate-500 text-sm space-y-2">
            <Utensils className="w-10 h-10 mx-auto text-slate-700" />
            <p>Nenhum plano alimentar cadastrado.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {dietPlans.map((plan) => {
              const currentVer = plan.versions?.[0];

              return (
                <div
                  key={plan.id}
                  className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-slate-100">{plan.title}</h4>
                        <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono text-xs font-bold">
                          v{plan.currentVersion}
                        </span>
                      </div>
                      {plan.goal && <p className="text-xs text-slate-400 mt-0.5">Objetivo: {plan.goal}</p>}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        Atualizado em {new Date(plan.updatedAt).toLocaleDateString("pt-BR")}
                      </span>

                      <button
                        onClick={() => setDeletingPlan({ id: plan.id, title: plan.title })}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-800/40 transition-colors"
                        title="Excluir Plano Alimentar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Macros Banner */}
                  {currentVer && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                        <span className="text-xs text-slate-400 block">Calorias Diárias</span>
                        <span className="text-xl font-bold font-mono text-amber-300">
                          {currentVer.targetCalories}
                        </span>
                        <span className="text-[10px] text-slate-500 block">kcal</span>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                        <span className="text-xs text-slate-400 block">Proteína</span>
                        <span className="text-xl font-bold font-mono text-emerald-400">
                          {currentVer.targetProteinG}g
                        </span>
                        <span className="text-[10px] text-slate-500 block">hipertrofia / anti-catabólico</span>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                        <span className="text-xs text-slate-400 block">Carboidratos</span>
                        <span className="text-xl font-bold font-mono text-blue-400">
                          {currentVer.targetCarbsG}g
                        </span>
                        <span className="text-[10px] text-slate-500 block">energia / treino</span>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                        <span className="text-xs text-slate-400 block">Gorduras</span>
                        <span className="text-xl font-bold font-mono text-purple-400">
                          {currentVer.targetFatG}g
                        </span>
                        <span className="text-[10px] text-slate-500 block">suporte hormonal</span>
                      </div>
                    </div>
                  )}

                  {/* Meals Breakdown */}
                  {currentVer?.meals && currentVer.meals.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <h5 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                        Estrutura de Refeições:
                      </h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {currentVer.meals.map((meal: any) => (
                          <div
                            key={meal.id}
                            className="p-3 rounded-lg bg-slate-950/40 border border-slate-800/80 space-y-1"
                          >
                            <div className="flex justify-between font-semibold text-slate-200">
                              <span>{meal.name}</span>
                              {meal.scheduledTime && (
                                <span className="text-slate-400 text-[11px] font-mono">
                                  {meal.scheduledTime}
                                </span>
                              )}
                            </div>
                            {meal.foods?.map((mf: any) => (
                              <div key={mf.id} className="text-[11px] text-slate-400 flex justify-between">
                                <span>{mf.food?.name}</span>
                                <span>{mf.portionG}g</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        isOpen={!!deletingPlan}
        title="Excluir Plano Alimentar"
        message={`Deseja realmente excluir o plano alimentar '${deletingPlan?.title}' e todo o seu histórico de macros?`}
        confirmText="Excluir Plano"
        cancelText="Cancelar"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={executeDeletePlan}
        onCancel={() => setDeletingPlan(null)}
      />

      {/* Toast Notification */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {/* New Diet Plan Modal */}
      {isNewPlanOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-400" />
              Criar Novo Plano Alimentar
            </h3>

            <form onSubmit={handleCreateDiet} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Título do Plano</label>
                <input
                  type="text"
                  placeholder="Ex: Cutting Agressivo 2026"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-sm text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Objetivo</label>
                <input
                  type="text"
                  placeholder="ex: Definição e queima de gordura"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Calorias (kcal)</label>
                  <input
                    type="number"
                    placeholder="ex: 2200"
                    value={calories}
                    onChange={(e) => setCalories(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Proteína (g)</label>
                  <input
                    type="number"
                    placeholder="ex: 190"
                    value={protein}
                    onChange={(e) => setProtein(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Carboidratos (g)</label>
                  <input
                    type="number"
                    placeholder="ex: 200"
                    value={carbs}
                    onChange={(e) => setCarbs(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Gorduras (g)</label>
                  <input
                    type="number"
                    placeholder="ex: 60"
                    value={fat}
                    onChange={(e) => setFat(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewPlanOpen(false)}
                  className="px-4 py-2 text-xs text-slate-300 bg-slate-800 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-500"
                >
                  Salvar Plano
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
