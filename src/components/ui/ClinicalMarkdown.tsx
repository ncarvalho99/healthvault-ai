"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { normalizeLegacyNotes } from "@/lib/markdown/legacy-notes";

interface ClinicalMarkdownProps {
  content: string;
  className?: string;
  preview?: boolean;
  maxPreviewChars?: number;
}

export function ClinicalMarkdown({
  content,
  className = "",
  preview = false,
  maxPreviewChars = 280,
}: ClinicalMarkdownProps) {
  if (!content) return null;

  let displayContent = normalizeLegacyNotes(content);

  if (preview && displayContent.length > maxPreviewChars) {
    const truncated = displayContent.slice(0, maxPreviewChars);
    const lastNewline = truncated.lastIndexOf("\n\n");
    const lastPeriod = truncated.lastIndexOf(". ");
    const cutPoint = lastNewline > 100 ? lastNewline : lastPeriod > 100 ? lastPeriod + 1 : maxPreviewChars;
    displayContent = displayContent.slice(0, cutPoint).trim() + " ...";
  }

  return (
    <div
      className={`prose prose-invert max-w-none text-xs leading-relaxed text-slate-200 ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => (
            <h1 className="text-sm font-bold text-slate-100 mt-3 mb-1.5 pb-1 border-b border-slate-800" {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mt-2.5 mb-1" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className="text-xs font-semibold text-slate-200 mt-2 mb-0.5" {...props} />
          ),
          p: ({ node, ...props }) => (
            <p className="mb-2 last:mb-0 leading-relaxed text-slate-300" {...props} />
          ),
          strong: ({ node, ...props }) => (
            <strong className="font-semibold text-emerald-300" {...props} />
          ),
          em: ({ node, ...props }) => (
            <em className="italic text-slate-300" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="list-disc list-inside mb-2 space-y-0.5 text-slate-300 pl-1" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="list-decimal list-inside mb-2 space-y-0.5 text-slate-300 pl-1" {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className="leading-relaxed" {...props} />
          ),
          hr: ({ node, ...props }) => (
            <hr className="my-2 border-slate-800" {...props} />
          ),
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-2 rounded border border-slate-800">
              <table className="min-w-full divide-y divide-slate-800 text-[11px]" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th className="px-2.5 py-1.5 bg-slate-900 text-left font-semibold text-slate-200" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="px-2.5 py-1 text-slate-300 border-t border-slate-800/60" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote className="border-l-2 border-emerald-500/60 pl-3 my-2 text-slate-400 italic" {...props} />
          ),
          code: ({ node, ...props }) => (
            <code className="px-1 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-emerald-300" {...props} />
          ),
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  );
}
