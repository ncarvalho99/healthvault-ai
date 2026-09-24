"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  MessageSquare,
  Sparkles,
  Pill,
  Utensils,
  HeartPulse,
  Clock,
  ShieldCheck,
  Settings,
  LogOut,
} from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { href: "/", label: "Visão Geral", icon: Activity },
    { href: "/conversations", label: "Conversas & Chat", icon: MessageSquare },
    { href: "/recommendations", label: "Recomendações", icon: Sparkles },
    { href: "/medications", label: "Medicamentos", icon: Pill },
    { href: "/diet", label: "Nutrição & Dieta", icon: Utensils },
    { href: "/health", label: "Métricas & Sintomas", icon: HeartPulse },
    { href: "/timeline", label: "Linha do Tempo", icon: Clock },
    { href: "/audit", label: "Auditoria & Logs", icon: ShieldCheck },
    { href: "/settings/integrations", label: "Configurações de IA", icon: Settings },
  ];

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {
      window.location.href = "/login";
    }
  };

  return (
    <aside className="w-64 bg-slate-900/90 border-r border-slate-800 flex flex-col h-screen select-none">
      {/* Brand Logo */}
      <div className="p-5 border-b border-slate-800/80 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-slate-100 tracking-tight text-base leading-none">
              HealthVault
            </h1>
            <span className="text-[10px] uppercase font-semibold text-emerald-400 tracking-wider">
              AI Knowledge Base
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? "text-emerald-400" : "text-slate-400"}`} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer / Logout */}
      <div className="p-4 border-t border-slate-800/80">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>Sair da Sessão</span>
        </button>
      </div>
    </aside>
  );
}
