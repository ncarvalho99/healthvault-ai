import React from "react";
import { displayRecommendationStatus } from "@/lib/recommendation-origin";
import { AlertCircle, CheckCircle2, UserCheck, Stethoscope, FileText, Archive } from "lucide-react";

export type BadgeStatus =
  | "AI_SUGGESTION"
  | "DOCTOR_RECOMMENDATION"
  | "USER_NOTE"
  | "CONFIRMED"
  | "ARCHIVED"
  | "DRAFT"
  | "UNVERIFIED_CLINICAL";

interface SafetyBadgeProps {
  status: BadgeStatus | string;
  /**
   * Recorded origin of the recommendation. Clinical-validation statuses are only rendered
   * as such when the origin is DOCTOR; without it they render as "unverified".
   */
  sourceType?: string | null;
  size?: "sm" | "md";
}

export function SafetyBadge({ status: rawStatus, sourceType, size = "md" }: SafetyBadgeProps) {
  const isSmall = size === "sm";
  const status = displayRecommendationStatus(rawStatus, sourceType);

  switch (status) {
    case "AI_SUGGESTION":
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-amber-950/70 border border-amber-600/50 text-amber-300 ${
            isSmall ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"
          }`}
          title="Sugestão gerada por Inteligência Artificial. Não substitui consulta médica."
        >
          <AlertCircle className={isSmall ? "w-3 h-3" : "w-3.5 h-3.5"} />
          <span>Sugestão de IA</span>
        </span>
      );

    case "DOCTOR_RECOMMENDATION":
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-blue-950/70 border border-blue-600/50 text-blue-300 ${
            isSmall ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"
          }`}
        >
          <Stethoscope className={isSmall ? "w-3 h-3" : "w-3.5 h-3.5"} />
          <span>Recomendação Médica</span>
        </span>
      );

    case "CONFIRMED":
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-emerald-950/70 border border-emerald-600/50 text-emerald-300 ${
            isSmall ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"
          }`}
        >
          <CheckCircle2 className={isSmall ? "w-3 h-3" : "w-3.5 h-3.5"} />
          <span>Validado / Confirmado</span>
        </span>
      );

    case "UNVERIFIED_CLINICAL":
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-slate-800 border border-amber-700/50 text-amber-200 ${
            isSmall ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"
          }`}
          title="Status clínico sem origem médica registrada. Não é uma validação médica verificada."
        >
          <AlertCircle className={isSmall ? "w-3 h-3" : "w-3.5 h-3.5"} />
          <span>Validação não verificada</span>
        </span>
      );

    case "DRAFT":
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-slate-800 text-slate-300 border border-slate-700 ${
            isSmall ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"
          }`}
        >
          <FileText className={isSmall ? "w-3 h-3" : "w-3.5 h-3.5"} />
          <span>Rascunho</span>
        </span>
      );

    case "USER_NOTE":
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-purple-950/70 border border-purple-600/50 text-purple-300 ${
            isSmall ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"
          }`}
        >
          <UserCheck className={isSmall ? "w-3 h-3" : "w-3.5 h-3.5"} />
          <span>Nota Pessoal</span>
        </span>
      );

    case "ARCHIVED":
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-slate-800 text-slate-400 border border-slate-700 ${
            isSmall ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"
          }`}
        >
          <Archive className={isSmall ? "w-3 h-3" : "w-3.5 h-3.5"} />
          <span>Arquivado</span>
        </span>
      );

    default:
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-slate-800 text-slate-300 border border-slate-700 ${
            isSmall ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"
          }`}
        >
          <FileText className={isSmall ? "w-3 h-3" : "w-3.5 h-3.5"} />
          <span>{status}</span>
        </span>
      );
  }
}
