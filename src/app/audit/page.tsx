"use client";

import React, { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { ShieldCheck, Filter, Clock, User, Globe } from "lucide-react";

export default function AuditPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/audit?limit=100")
      .then((res) => res.json())
      .then((data) => {
        setLogs(data.auditLogs || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load audit logs:", err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
      <Header
        title="Trilha de Auditoria & Segurança"
        subtitle="Registro imutável de autenticações, criações de versões e operações críticas"
      />

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-100">Audit Logs (Append-Only Ledger)</h3>
            <p className="text-xs text-slate-400">
              Todos os eventos críticos são gravados com IP, data e metadados sanitizados.
            </p>
          </div>
          <span className="text-xs text-emerald-400 font-mono font-bold bg-emerald-950 px-3 py-1 rounded-lg border border-emerald-800">
            {logs.length} Registros
          </span>
        </div>

        {loading ? (
          <div className="text-center py-20 text-slate-400 text-sm">Carregando trilha de auditoria...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-20 text-slate-500 text-sm">Nenhum log gravado.</div>
        ) : (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase font-mono text-[10px] tracking-wider">
                  <tr>
                    <th className="p-3">Data / Hora</th>
                    <th className="p-3">Ação</th>
                    <th className="p-3">Entidade</th>
                    <th className="p-3">IP de Origem</th>
                    <th className="p-3">Metadados</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300 font-sans">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="p-3 whitespace-nowrap text-slate-400 font-mono text-[11px]">
                        {new Date(log.timestamp).toLocaleString("pt-BR")}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                            log.action.includes("FAILED") || log.action.includes("RATE_LIMITED")
                              ? "bg-rose-950 text-rose-400 border border-rose-800"
                              : log.action.includes("CREATED") || log.action.includes("VERSION")
                              ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                              : "bg-slate-800 text-slate-300"
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap font-medium text-slate-200">
                        {log.entity}
                      </td>
                      <td className="p-3 whitespace-nowrap font-mono text-slate-400 text-[11px]">
                        {log.ipAddress || "127.0.0.1"}
                      </td>
                      <td className="p-3 text-[11px] text-slate-400 font-mono max-w-md truncate">
                        {log.metadata ? JSON.stringify(log.metadata) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
