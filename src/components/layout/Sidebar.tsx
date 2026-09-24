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
  Users,
  KeyRound,
  LogOut,
  X,
} from "lucide-react";
import { useNav } from "./NavContext";

export function Sidebar() {
  const pathname = usePathname();
  const { mobileOpen, setMobileOpen, currentUser } = useNav();

  const isAdmin = currentUser?.role === "ADMIN";

  // Base navigation items accessible to all users
  const userNavItems = [
    { href: "/", label: "Visão Geral", icon: Activity },
    { href: "/conversations", label: "Conversas & Chat", icon: MessageSquare },
    { href: "/recommendations", label: "Recomendações", icon: Sparkles },
    { href: "/medications", label: "Medicamentos", icon: Pill },
    { href: "/diet", label: "Nutrição & Dieta", icon: Utensils },
    { href: "/health", label: "Métricas & Sintomas", icon: HeartPulse },
    { href: "/timeline", label: "Linha do Tempo", icon: Clock },
    { href: "/settings/password", label: "Alterar Senha", icon: KeyRound },
  ];

  // Admin exclusive navigation items
  const adminNavItems = [
    { href: "/audit", label: "Auditoria & Logs", icon: ShieldCheck },
    { href: "/settings/users", label: "Gerenciar Usuários", icon: Users },
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

  const navContent = (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 select-none">
      {/* Brand Logo & Close Button for Mobile */}
      <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
        <Link
          href="/"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2.5"
        >
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

        {/* Mobile close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          aria-label="Fechar menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* User identity badge */}
      {currentUser && (
        <div className="px-4 py-2.5 bg-slate-950/60 border-b border-slate-800/60 flex items-center justify-between text-xs">
          <div className="truncate mr-2">
            <span className="text-slate-400 block text-[10px]">Conectado como</span>
            <span className="font-medium text-slate-200 truncate block">
              {currentUser.fullName || currentUser.username}
            </span>
          </div>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase shrink-0 ${
              isAdmin
                ? "bg-purple-950/80 text-purple-300 border border-purple-800/50"
                : "bg-emerald-950/80 text-emerald-300 border border-emerald-800/50"
            }`}
          >
            {currentUser.role}
          </span>
        </div>
      )}

      {/* Navigation Links */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-3 py-1">
          Menu Principal
        </div>
        {userNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 font-semibold"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? "text-emerald-400" : "text-slate-400"}`} />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* Admin Navigation Section */}
        {isAdmin && (
          <>
            <div className="pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-3">
              Administração
            </div>
            {adminNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 font-semibold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-emerald-400" : "text-slate-400"}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* Footer / Logout */}
      <div className="p-3 border-t border-slate-800/80">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>Sair da Sessão</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar (hidden on mobile, fixed width on md+) */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:shrink-0 h-screen select-none">
        {navContent}
      </aside>

      {/* Mobile Slide-over Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 md:hidden transition-opacity"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Slide-over Drawer Panel */}
      <aside
        className={`fixed top-0 bottom-0 left-0 w-72 max-w-[85vw] z-50 md:hidden transform transition-transform duration-300 ease-in-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {navContent}
      </aside>
    </>
  );
}
