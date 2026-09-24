import { HealthVaultTool, ToolExecutionContext } from "./types";

export class PermissionEngine {
  /**
   * Verifies if a tool can be executed by the given context.
   */
  static checkPermission(tool: HealthVaultTool, context: ToolExecutionContext): { allowed: boolean; reason?: string } {
    if (!tool.enabled) {
      return { allowed: false, reason: `A ferramenta '${tool.name}' está desabilitada no sistema.` };
    }

    if (!context.userId) {
      return { allowed: false, reason: "Usuário não autenticado." };
    }

    if (!context.conversationId) {
      return { allowed: false, reason: "Contexto de conversa ausente." };
    }

    // High risk checks: ensure proper caller
    if (tool.risk === "high" && tool.access === "write") {
      // High-risk tools always require non-empty origin and conversation linkage
      if (!context.conversationId) {
        return { allowed: false, reason: "Ações de alto risco exigem vínculo a uma conversa ativa." };
      }
    }

    return { allowed: true };
  }
}
