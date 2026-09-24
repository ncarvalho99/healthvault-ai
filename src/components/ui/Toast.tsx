"use client";

import React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export interface ToastProps {
  type: "success" | "error" | "info";
  message: string;
  onClose: () => void;
}

export function Toast({ type, message, onClose }: ToastProps) {
  return (
    <div className="fixed bottom-5 right-5 z-[110] flex items-center gap-3 px-4 py-3 rounded-xl border bg-slate-900 shadow-2xl text-xs max-w-md animate-in slide-in-from-bottom-5 duration-200">
      {type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
      {type === "error" && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
      {type === "info" && <Info className="w-4 h-4 text-blue-400 shrink-0" />}

      <span className="text-slate-200 flex-1 leading-relaxed">{message}</span>

      <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-0.5">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
