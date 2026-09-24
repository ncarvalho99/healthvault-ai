"use client";

import React, { useState } from "react";
import { Globe, ChevronDown, ChevronUp, ExternalLink, ShieldCheck, AlertCircle } from "lucide-react";

export interface ResearchSourceItem {
  id: string;
  title: string;
  url: string;
  domain: string;
  tier?: number;
  isAnecdotal?: boolean;
  publishedAt?: string;
  retrievedAt?: string;
}

interface ResearchSourcesCollapsibleProps {
  sources: ResearchSourceItem[];
  runId?: string;
  provider?: string;
}

export function ResearchSourcesCollapsible({ sources, runId, provider }: ResearchSourcesCollapsibleProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!sources || sources.length === 0) return null;

  const tierBadge = (tier?: number, isAnecdotal?: boolean) => {
    if (isAnecdotal || tier === 4) {
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-950/80 text-amber-300 border border-amber-800/60">
          <AlertCircle className="w-2.5 h-2.5" />
          Anedótico
        </span>
      );
    }
    if (tier === 1) {
      return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
          <ShieldCheck className="w-2.5 h-2.5" />
          Autoridade / PubMed
        </span>
      );
    }
    if (tier === 2) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-950/80 text-blue-300 border border-blue-800/60">
          Acadêmico
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700/60">
        Referência
      </span>
    );
  };

  return (
    <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-xs">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-1 px-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800/70 text-slate-300 hover:text-slate-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="font-semibold text-[11px] text-slate-200">
            Fontes consultadas na web
          </span>
          <span className="px-1.5 py-0.2 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/50 text-[10px] font-mono font-bold">
            {sources.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <span className="text-[10px] font-mono hidden sm:inline">
            {isOpen ? "Recolher" : "Expandir"}
          </span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {isOpen && (
        <div className="mt-2 space-y-1.5 pl-1 pr-1">
          <div className="text-[10px] text-slate-400 flex items-center justify-between pb-1 px-1">
            <span>Evidências externas indexadas em tempo real</span>
            {provider && <span className="font-mono text-slate-400">Provedor: {provider}</span>}
          </div>

          <div className="grid gap-1.5">
            {sources.map((s, idx) => (
              <a
                key={s.id || idx}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col p-2 rounded-lg bg-slate-950/60 hover:bg-slate-900 border border-slate-800/80 hover:border-emerald-500/40 transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/50 px-1 py-0.5 rounded shrink-0">
                      [{s.id || `S${idx + 1}`}]
                    </span>
                    <span className="font-medium text-slate-200 group-hover:text-emerald-300 truncate text-[11px]">
                      {s.title}
                    </span>
                  </div>
                  <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-emerald-400 shrink-0 mt-0.5" />
                </div>

                <div className="flex items-center justify-between gap-2 mt-1.5 pt-1 border-t border-slate-900 text-[10px] text-slate-400">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="font-mono text-slate-300 font-medium">{s.domain}</span>
                    {s.publishedAt && <span>• {s.publishedAt}</span>}
                  </div>
                  <div>{tierBadge(s.tier, s.isAnecdotal)}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
