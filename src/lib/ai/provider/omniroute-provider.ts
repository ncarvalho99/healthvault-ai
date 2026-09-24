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
   * Performs standard chat completion with tool calling
   */
  static async chatCompletion(params: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: any[];
    tools?: any[];
    toolChoice?: any;
    sessionId?: string;
    timeoutMs?: number;
  }) {
    const { chatUrl } = normalizeBaseUrl(params.baseUrl);
    const timeout = params.timeoutMs || 120000;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
      "X-Request-Id": crypto.randomUUID(),
    };

    if (params.sessionId) {
      headers["X-Session-Id"] = params.sessionId.startsWith("healthvault:")
        ? params.sessionId
        : `healthvault:${params.sessionId}`;
    }

    const body: Record<string, any> = {
      model: params.model,
      messages: params.messages,
    };

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
}
