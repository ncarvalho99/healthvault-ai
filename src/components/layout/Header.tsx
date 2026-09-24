"use client";

import React from "react";
import { ShieldCheck, HeartPulse, Menu } from "lucide-react";
import { useNav } from "./NavContext";

interface HeaderProps {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title = "Painel Clínico", subtitle, actions }: HeaderProps) {
  const { setMobileOpen } = useNav();

  return (
    <header className="min-h-16 py-2 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20 shrink-0 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile Hamburger Menu Toggle */}
        <button
          onClick={() => setMobileOpen(true)}
          className="md:hidden p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 focus:outline-none shrink-0"
          aria-label="Abrir menu de navegação"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="min-w-0 truncate">
          <h2 className="text-sm sm:text-base font-semibold text-slate-100 truncate">{title}</h2>
          {subtitle && (
            <p className="text-xs text-slate-400 truncate hidden sm:block">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {actions}

        {/* System Integrity Badge */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-xs shrink-0">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="font-medium">Audit Trail Ativo</span>
        </div>

        {/* Clinical Safety Indicator */}
        <div className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-slate-300 text-xs shrink-0">
          <HeartPulse className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden xs:inline">Homelab</span> Vault
        </div>
      </div>
    </header>
  );
}
