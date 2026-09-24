"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MessageContentProps {
  content: string;
  senderType?: "USER" | "AI" | "SYSTEM" | "TOOL";
}

export function MessageContent({ content, senderType = "AI" }: MessageContentProps) {
  if (!content) return null;

  return (
    <div className={`prose prose-invert max-w-none text-sm leading-relaxed ${senderType === "USER" ? "text-white" : "text-slate-100"}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => <h1 className="text-base font-bold text-slate-100 mt-2 mb-1.5" {...props} />,
          h2: ({ node, ...props }) => <h2 className="text-sm font-bold text-slate-100 mt-2 mb-1" {...props} />,
          h3: ({ node, ...props }) => <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mt-2 mb-1" {...props} />,
          p: ({ node, ...props }) => <p className="mb-2 last:mb-0 leading-relaxed whitespace-pre-wrap" {...props} />,
          strong: ({ node, ...props }) => <strong className="font-semibold text-emerald-300" {...props} />,
          em: ({ node, ...props }) => <em className="italic text-slate-300" {...props} />,
          ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-2 space-y-0.5 text-slate-200" {...props} />,
          ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-2 space-y-0.5 text-slate-200" {...props} />,
          li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
          hr: ({ node, ...props }) => <hr className="my-2.5 border-slate-700/80" {...props} />,
          blockquote: ({ node, ...props }) => (
            <blockquote className="border-l-2 border-emerald-500/80 pl-3 my-2 text-xs italic text-slate-300 bg-slate-900/40 py-1 rounded-r" {...props} />
          ),
          code: ({ node, className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match && !String(children).includes("\n");
            if (isInline) {
              return (
                <code className="bg-slate-900 border border-slate-700/70 text-emerald-300 px-1.5 py-0.5 rounded text-[11px] font-mono" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <pre className="bg-slate-950 p-3 rounded-lg border border-slate-800 overflow-x-auto text-xs font-mono text-slate-200 my-2">
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            );
          },
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-slate-800">
              <table className="w-full text-left text-xs divide-y divide-slate-800" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => <th className="bg-slate-900 p-2 font-semibold text-slate-300 uppercase font-mono text-[10px]" {...props} />,
          td: ({ node, ...props }) => <td className="p-2 border-t border-slate-800/60 text-slate-200" {...props} />,
          a: ({ node, ...props }) => (
            <a
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 transition-colors"
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
