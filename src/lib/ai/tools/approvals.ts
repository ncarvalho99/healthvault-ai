import { HealthVaultTool, ToolExecutionContext } from "./types";
import { db } from "../../db";

export class ApprovalEngine {
  /**
   * Retrieves or creates default AI Write Policy for user
   */
  static async getUserWritePolicy(userId: string) {
    let policy = await db.aiWritePolicy.findUnique({
      where: { userId },
    });

    if (!policy) {
      policy = await db.aiWritePolicy.create({
        data: {
          userId,
          recommendations: "AUTO_APPLY",
          nutrition: "AUTO_APPLY",
          metrics: "AUTO_APPLY",
          symptoms: "AUTO_APPLY",
          labs: "REVIEW_FIRST",
          medications: "REVIEW_FIRST",
          dosageChanges: "REVIEW_FIRST",
        },
      });
    }

    return policy;
  }

  /**
   * Checks whether the tool execution requires human approval before applying changes
   */
  static async requiresApproval(
    tool: HealthVaultTool,
    context: ToolExecutionContext,
    args: any
  ): Promise<boolean> {
    if (tool.access === "read") return false;
    if (tool.requiresApproval === true) return true;
    if (tool.requiresApproval === false) return false;

    // Check policy-driven tools
    const policy = await this.getUserWritePolicy(context.userId);

    switch (tool.category) {
      case "recommendations":
        return policy.recommendations === "REVIEW_FIRST";

      case "nutrition":
        return policy.nutrition === "REVIEW_FIRST";

      case "metrics":
        return policy.metrics === "REVIEW_FIRST";

      case "symptoms":
        return policy.symptoms === "REVIEW_FIRST";

      case "labs":
        return policy.labs === "REVIEW_FIRST";

      case "medications":
        if (tool.name === "healthvault_update_medication") {
          return policy.dosageChanges === "REVIEW_FIRST";
        }
        return policy.medications === "REVIEW_FIRST";

      default:
        return false;
    }
  }
}
