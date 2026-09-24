import crypto from "node:crypto";

export interface NormalizedUrls {
  baseUrl: string;
  modelsUrl: string;
  chatUrl: string;
}

export function normalizeBaseUrl(rawUrl: string): NormalizedUrls {
  let clean = rawUrl.trim().replace(/\/+$/, "");
  const hasV1 = clean.endsWith("/v1");
  const baseUrl = hasV1 ? clean : `${clean}/v1`;
  const modelsUrl = `${baseUrl}/models`;
  const chatUrl = `${baseUrl}/chat/completions`;

  return { baseUrl, modelsUrl, chatUrl };
}

export interface ModelItem {
  id: string;
  displayName: string;
  ownedBy?: string;
  isCombo: boolean;
  rawMetadata?: any;
}

export interface ABSuppressionProbeVariantResult {
  variant: "A" | "B" | "C" | "D";
  description: string;
  payload: Record<string, any>;
  requestAccepted: boolean;
  httpStatus?: number;
  reasoningLeakDetected: boolean;
  reasoningFieldDetected: boolean;
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  latency_ms: number;
  finish_reason?: string;
  error?: string;
}

export interface ABSuppressionProbeReport {
  modelId: string;
  timestamp: string;
  variants: ABSuppressionProbeVariantResult[];
  upstreamControlEffective: boolean;
  upstreamReasoningControl: "EFFECTIVE" | "PARTIAL" | "NOT_EFFECTIVE" | "REJECTED";
  recommendedPolicy: string;
  summary: string;
}

export class OmniRouteProvider {
  /**
   * Tests connection and measure latency
   */
  static async testConnection(baseUrl: string, apiKey: string, timeoutMs = 15000) {
    const { modelsUrl } = normalizeBaseUrl(baseUrl);
    const start = performance.now();

    try {
      const res = await fetch(modelsUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "X-Request-Id": crypto.randomUUID(),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const latencyMs = Math.round(performance.now() - start);

      if (!res.ok) {
        let errMessage = `HTTP ${res.status} ${res.statusText}`;
        try {
          const errData = await res.json();
          if (errData?.error?.message) errMessage = errData.error.message;
        } catch {
          // ignore
        }
        return { success: false, error: errMessage, latencyMs };
      }

      const data = await res.json();
      const modelsCount = Array.isArray(data?.data) ? data.data.length : 0;

      return {
        success: true,
        latencyMs,
        modelsCount,
        data,
      };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - start);
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      return {
        success: false,
        error: isTimeout ? `Connection timed out after ${timeoutMs}ms` : err?.message || "Failed to reach OmniRoute host",
        latencyMs,
      };
    }
  }

  /**
   * Fetches models and categorizes combos
   */
  static async listModels(baseUrl: string, apiKey: string, timeoutMs = 20000): Promise<ModelItem[]> {
    const { modelsUrl } = normalizeBaseUrl(baseUrl);

    const res = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Failed to list models from OmniRoute: HTTP ${res.status}`);
    }

    const data = await res.json();
    const rawList = Array.isArray(data?.data) ? data.data : [];

    return rawList.map((m: any) => {
      const id = String(m.id);
      const ownedBy = m.owned_by ? String(m.owned_by) : undefined;
      // In OmniRoute, user-defined combos strictly have owned_by = "combo" and do NOT start with synthetic "auto/" routes
      const isCombo = ownedBy === "combo" && !id.startsWith("auto/");

      return {
        id,
        displayName: m.name || id,
        ownedBy,
        isCombo,
        rawMetadata: m,
      };
    });
  }

  /**
   * Verifies if a given model/combo reliably supports OpenAI tool calling
   */
  static async testToolCalling(baseUrl: string, apiKey: string, modelId: string, timeoutMs = 25000): Promise<{ supportsTools: boolean; latencyMs: number; error?: string }> {
    const { chatUrl } = normalizeBaseUrl(baseUrl);
    const start = performance.now();

    const pingTool = {
      type: "function",
      function: {
        name: "healthvault_ping",
        description: "Test ping function to verify tool calling capabilities.",
        parameters: {
          type: "object",
          properties: {
            value: { type: "string", description: "The word 'ping'" },
          },
          required: ["value"],
        },
      },
    };

    try {
      const res = await fetch(chatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Request-Id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            {
              role: "user",
              content: "Please execute healthvault_ping with value 'ping'. Do not answer with plain text, only call the tool.",
            },
          ],
          tools: [pingTool],
          tool_choice: "auto",
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const latencyMs = Math.round(performance.now() - start);

      if (!res.ok) {
        return { supportsTools: false, latencyMs, error: `HTTP ${res.status}` };
      }

      const data = await res.json();
      const message = data?.choices?.[0]?.message;
      const toolCalls = message?.tool_calls;

      const calledPing = Array.isArray(toolCalls) && toolCalls.some((tc: any) => tc.function?.name === "healthvault_ping");

      return {
        supportsTools: calledPing,
        latencyMs,
      };
    } catch (err: any) {
      return {
        supportsTools: false,
        latencyMs: Math.round(performance.now() - start),
        error: err?.message,
      };
    }
  }

  /**
   * Performs standard chat completion with tool calling, reasoning controls, and correlation IDs
   */
  static async chatCompletion(params: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: any[];
    tools?: any[];
    toolChoice?: any;
    sessionId?: string;
    requestId?: string;
    correlationId?: string;
    reasoningPolicy?: "AUTO" | "DISABLED" | "LOW" | "MEDIUM" | "HIGH";
    rawPayloadOverrides?: Record<string, any>;
    timeoutMs?: number;
  }) {
    const { chatUrl } = normalizeBaseUrl(params.baseUrl);
    const timeout = params.timeoutMs || 120000;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
      "X-Request-Id": params.requestId || crypto.randomUUID(),
    };

    if (params.correlationId) {
      headers["X-Correlation-Id"] = params.correlationId;
    }

    if (params.sessionId) {
      headers["X-Session-Id"] = params.sessionId.startsWith("healthvault:")
        ? params.sessionId
        : `healthvault:${params.sessionId}`;
    }

    const body: Record<string, any> = {
      model: params.model,
      messages: params.messages,
      ...(params.rawPayloadOverrides || {}),
    };

    // Apply upstream reasoning controls only when not overridden by explicit probe payload
    if (!params.rawPayloadOverrides) {
      if (params.reasoningPolicy === "DISABLED") {
        body.reasoning_effort = "none";
        body.thinking = { type: "disabled" };
      } else if (params.reasoningPolicy === "LOW") {
        body.reasoning_effort = "low";
        body.thinking = { type: "enabled", budget_tokens: 1024 };
      } else if (params.reasoningPolicy === "MEDIUM") {
        body.reasoning_effort = "medium";
      } else if (params.reasoningPolicy === "HIGH") {
        body.reasoning_effort = "high";
      }
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      body.tool_choice = params.toolChoice || "auto";
    }

    const res = await fetch(chatUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      let errText = `HTTP ${res.status} ${res.statusText}`;
      try {
        const errJson = await res.json();
        if (errJson?.error?.message) errText = errJson.error.message;
      } catch {
        // ignore
      }
      throw new Error(`OmniRoute Chat Completion failed: ${errText}`);
    }

    return res.json();
  }

  /**
   * Diagnostic A/B Reasoning Suppression Probe
   * Evaluates if upstream parameters can suppress reasoning or if client-side sanitization is required.
   *
   * A: reasoning_effort = "none"
   * B: thinking = false
   * C: thinking = { type: "disabled" }
   * D: Control (no reasoning parameters)
   *
   * Gathers telemetry without ever persisting textual reasoning.
   */
  static async testReasoningSuppressionAB(
    baseUrl: string,
    apiKey: string,
    modelId: string,
    timeoutMs = 25000
  ): Promise<ABSuppressionProbeReport> {
    const variantsConfig = [
      {
        variant: "A" as const,
        description: 'reasoning_effort = "none"',
        payload: { reasoning_effort: "none" },
      },
      {
        variant: "B" as const,
        description: "thinking = false",
        payload: { thinking: false },
      },
      {
        variant: "C" as const,
        description: 'thinking = { type: "disabled" }',
        payload: { thinking: { type: "disabled" } },
      },
      {
        variant: "D" as const,
        description: "Controle (sem parâmetros de reasoning)",
        payload: {},
      },
    ];

    const results: ABSuppressionProbeVariantResult[] = [];

    for (const v of variantsConfig) {
      const start = performance.now();
      try {
        const completion = await this.chatCompletion({
          baseUrl,
          apiKey,
          model: modelId,
          messages: [{ role: "user", content: "Diga 'OK' e nada mais." }],
          rawPayloadOverrides: v.payload,
          timeoutMs,
        });

        const latency_ms = Math.round(performance.now() - start);
        const choice = completion?.choices?.[0];
        const msg = choice?.message;
        const rawContent = msg?.content || "";

        const reasoningLeakDetected = /<(think|thinking|reasoning)>/i.test(rawContent);
        const reasoningFieldDetected = Boolean(
          msg?.reasoning_content || msg?.reasoning || msg?.thinking || msg?.analysis
        );

        const usage = completion?.usage;
        const prompt_tokens = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
        const completion_tokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
        const reasoning_tokens =
          typeof usage?.completion_tokens_details?.reasoning_tokens === "number"
            ? usage.completion_tokens_details.reasoning_tokens
            : typeof usage?.reasoning_tokens === "number"
            ? usage.reasoning_tokens
            : undefined;

        results.push({
          variant: v.variant,
          description: v.description,
          payload: v.payload,
          requestAccepted: true,
          httpStatus: 200,
          reasoningLeakDetected,
          reasoningFieldDetected,
          prompt_tokens,
          completion_tokens,
          reasoning_tokens,
          latency_ms,
          finish_reason: choice?.finish_reason,
        });
      } catch (err: any) {
        const latency_ms = Math.round(performance.now() - start);
        results.push({
          variant: v.variant,
          description: v.description,
          payload: v.payload,
          requestAccepted: false,
          reasoningLeakDetected: false,
          reasoningFieldDetected: false,
          latency_ms,
          error: err.message || "Request failed",
        });
      }
    }

    // Determine upstream effectiveness across suppression variants (A, B, C)
    const suppressionVariants = results.filter((r) => r.variant !== "D");
    const anyAccepted = suppressionVariants.some((r) => r.requestAccepted);
    const anyEffective = suppressionVariants.some(
      (r) => r.requestAccepted && !r.reasoningLeakDetected && !r.reasoningFieldDetected
    );

    let upstreamReasoningControl: "EFFECTIVE" | "PARTIAL" | "NOT_EFFECTIVE" | "REJECTED" = "NOT_EFFECTIVE";
    let summary = "";

    if (!anyAccepted) {
      upstreamReasoningControl = "REJECTED";
      summary = "O gateway upstream rejeitou os parâmetros de supressão de raciocínio.";
    } else if (anyEffective) {
      upstreamReasoningControl = "EFFECTIVE";
      summary = "Ao menos uma estratégia upstream suprimiu com sucesso os blocos de raciocínio.";
    } else {
      upstreamReasoningControl = "NOT_EFFECTIVE";
      summary =
        "O combo aceitou as chamadas, mas persistiu vazando raciocínio (<thinking> ou reasoning fields). Upstream control is NOT_EFFECTIVE; sanitização client-side no HealthVault é indispensável.";
    }

    return {
      modelId,
      timestamp: new Date().toISOString(),
      variants: results,
      upstreamControlEffective: anyEffective,
      upstreamReasoningControl,
      recommendedPolicy: anyEffective ? "UPSTREAM_SUPPORTED" : "HEALTHVAULT_FILTER_MANDATORY",
      summary,
    };
  }

  /**
   * Tests whether a model supports upstream reasoning suppression
   */
  static async testReasoningSuppression(baseUrl: string, apiKey: string, modelId: string, timeoutMs = 25000) {
    const report = await this.testReasoningSuppressionAB(baseUrl, apiKey, modelId, timeoutMs);
    const anyLeak = report.variants.some((v) => v.reasoningLeakDetected || v.reasoningFieldDetected);
    const anyField = report.variants.some((v) => v.reasoningFieldDetected);

    return {
      status: report.upstreamControlEffective
        ? "SUPPORTED"
        : report.upstreamReasoningControl === "REJECTED"
        ? "NOT_SUPPORTED"
        : "NOT_EFFECTIVE",
      hasTag: anyLeak,
      hasField: anyField,
      latencyMs: report.variants[0]?.latency_ms || 0,
      report,
    };
  }
}
