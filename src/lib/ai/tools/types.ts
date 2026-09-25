import { z, ZodSchema } from "zod";

export type ToolCategory =
  | "system"
  | "context"
  | "recommendations"
  | "medications"
  | "nutrition"
  | "metrics"
  | "symptoms"
  | "labs"
  | "timeline"
  | "reminders";

export type ToolAccess = "read" | "write";
export type ToolRisk = "low" | "medium" | "high";

export type ApprovalRequirement = true | false | "policy";

export interface ToolExecutionContext {
  userId: string;
  conversationId: string;
  messageId?: string;
  integrationId?: string;
  toolCallId: string;
  toolName: string;
  rawArguments: string | Record<string, any>;
  informationOrigin?: string;
  agentMode?: "AGENT" | "CHAT_ONLY" | "MANUAL";
}

export interface ToolExecutionResult {
  success: boolean;
  requires_approval?: boolean;
  execution_id?: string;
  message?: string;
  proposal?: any;
  data?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export type ToolHandler = (context: ToolExecutionContext, validatedArgs: any) => Promise<ToolExecutionResult>;

export interface HealthVaultTool {
  name: string;
  version: number;
  description: string;
  category: ToolCategory;
  access: ToolAccess;
  risk: ToolRisk;
  permission: string;
  requiresApproval: ApprovalRequirement;
  inputSchema: ZodSchema;
  outputSchema?: ZodSchema;
  handler: ToolHandler;
  enabled: boolean;
}

export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}
