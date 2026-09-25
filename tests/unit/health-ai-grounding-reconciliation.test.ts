import { describe, it, after } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { EvidenceConsistencyGate } from "../../src/lib/ai/response/evidence-consistency-gate";
import { SearchResult } from "../../src/lib/ai/research/types";
import { POST as chatPOST } from "../../src/app/api/ai/chat/route";
import { createSessionToken } from "../../src/lib/auth";
import { encryptApiKey } from "../../src/lib/ai/crypto";
import { db } from "../../src/lib/db";
import { HealthService } from "../../src/lib/services/health-service";
import { ResearchOrchestrator } from "../../src/lib/ai/research/research-orchestrator";
import { OmniRouteProvider } from "../../src/lib/ai/provider/omniroute-provider";

describe("health-ai — Fresh Evidence Grounding & Current-State Reconciliation", () => {
  const origUserFindUnique = db.user.findUnique;
  const origConvFindFirst = db.conversation.findFirst;
  const origConvUpdate = db.conversation.update;
  const origIntegrationFindFirst = db.aiIntegration.findFirst;
  const origMessageCreate = db.message.create;
  const origMessageFindMany = db.message.findMany;
  const origMessageFindFirst = db.message.findFirst;
  const origBodyMetricFindFirst = db.bodyMetric.findFirst;
  const origAuditCreate = db.auditLog.create;
  const origHealthSummary = HealthService.getSummaryContext;
  const origResearchExecute = ResearchOrchestrator.execute;
  const origChatCompletion = OmniRouteProvider.chatCompletion;

  after(() => {
    db.user.findUnique = origUserFindUnique;
    db.conversation.findFirst = origConvFindFirst;
    db.conversation.update = origConvUpdate;
    db.aiIntegration.findFirst = origIntegrationFindFirst;
    db.message.create = origMessageCreate;
    db.message.findMany = origMessageFindMany;
    db.message.findFirst = origMessageFindFirst;
    db.bodyMetric.findFirst = origBodyMetricFindFirst;
    db.auditLog.create = origAuditCreate;
    HealthService.getSummaryContext = origHealthSummary;
    ResearchOrchestrator.execute = origResearchExecute;
    OmniRouteProvider.chatCompletion = origChatCompletion;
  });

  const dummySources: SearchResult[] = [
    {
      id: "S1",
      title: "TRIUMPH-1 and TRIUMPH-2 Phase 3 Clinical Trial Results Reported in 2026",
      url: "https://clinicaltrials.gov/study/NCT06383390",
      snippet:
        "Phase 3 clinical trial results published demonstrating substantial weight reduction and glycemic control for retatrutide.",
      tier: 1,
      isAnecdotal: false,
      retrievedAt: new Date().toISOString(),
    },
  ];

  it("1. repeated current question + new web sources → fresh answer required (lazy repetition flagged)", () => {
    // Prohibited lazy response referencing previous chat turn
    const lazyAssistantResponse = "Como já respondido acima, não há novidades. Mesma resposta de antes.";

    const gateCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "Qual é o status atual da retatrutida?",
      assistantText: lazyAssistantResponse,
      sources: dummySources,
    });

    assert.strictEqual(
      gateCheck.isValid,
      false,
      "Must fail consistency check when assistant lazily refers to previous messages"
    );
    assert.ok(
      gateCheck.violations.some((v) => v.includes("LAZY_REPETITION_REFERENCE")),
      "Must flag LAZY_REPETITION_REFERENCE"
    );

    // Valid fresh synthesis based on 2026 sources
    const freshAssistantResponse =
      "Com base nas evidências clínicas mais recentes de 2026, os ensaios de Fase 3 TRIUMPH-1 e TRIUMPH-2 já reportaram resultados expressivos de eficácia e segurança na redução de peso e controle glicêmico.";

    const validCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "Qual é o status atual da retatrutida?",
      assistantText: freshAssistantResponse,
      sources: dummySources,
    });

    assert.strictEqual(validCheck.isValid, true, "Fresh clinical synthesis must pass consistency check");
    assert.strictEqual(validCheck.violations.length, 0);
  });

  it("2. stale assistant history vs current Vault → Vault wins", () => {
    // Current Vault state has Semaglutide 2 mg active / version 3
    const liveVaultBlock = `
<healthvault_data>
<records>
CURRENT PATIENT STATE:
- Active Medications: Semaglutida (2 mg, semanal, v3); Metformina (500 mg, 2x/dia, v1)
</records>
</healthvault_data>
    `;

    // Stale assistant response relying on conversation history claiming 2 mg is still pending
    const staleResponse =
      "A sua dose de 2 mg está pendente de aprovação no chat, portanto seu medicamento atual ainda é 1 mg.";

    const failCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "Qual é minha dose atual?",
      assistantText: staleResponse,
      vaultContextBlock: liveVaultBlock,
    });

    assert.strictEqual(
      failCheck.isValid,
      false,
      "Must flag violation when assistant claims dose is pending despite Vault showing active"
    );
    assert.ok(
      failCheck.violations.some((v) => v.includes("STALE_PROSE_VS_VAULT")),
      "Must flag STALE_PROSE_VS_VAULT"
    );

    // Correct response recognizing active Vault state
    const correctResponse =
      "Seu registro atual no HealthVault confirma que a Semaglutida está ativa na dose de 2 mg semanal (versão 3 aplicada com sucesso).";

    const passCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "Qual é minha dose atual?",
      assistantText: correctResponse,
      vaultContextBlock: liveVaultBlock,
    });

    assert.strictEqual(passCheck.isValid, true, "Grounded response matching active Vault must pass");
  });

  it("3. Ozempic titration must not inherit Wegovy 1.7 mg step based on evidence sources", () => {
    const dosingSources: SearchResult[] = [
      {
        id: "D1",
        title: "FDA and ANVISA Product Labeling — Wegovy vs Ozempic Dosing Schedules",
        url: "https://fda.gov/drugs/postmarket-drug-safety-information",
        snippet:
          "Wegovy is indicated for chronic weight management with weekly titration steps of 0.25 mg, 0.5 mg, 1.0 mg, 1.7 mg, and 2.4 mg. Ozempic is approved for type 2 diabetes with weekly doses of 0.25 mg, 0.5 mg, 1.0 mg, and 2.0 mg. The 1.7 mg dose is exclusive to Wegovy.",
        tier: 1,
        isAnecdotal: false,
        retrievedAt: new Date().toISOString(),
      },
    ];

    // Contaminated response mixing Wegovy step into Ozempic
    const contaminatedResponse =
      "O esquema de titulação do Ozempic inicia em 0.25 mg, passando para 0.5 mg, 1.0 mg, depois 1.7 mg e no máximo 2.0 mg.";

    const failCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "Como funciona a titulação do Ozempic?",
      assistantText: contaminatedResponse,
      sources: dosingSources,
    });

    assert.strictEqual(failCheck.isValid, false, "Must detect cross-product dosing contamination against sources");
    assert.ok(
      failCheck.violations.some((v) => v.includes("CROSS_PRODUCT_DOSING_CONTAMINATION")),
      "Must flag CROSS_PRODUCT_DOSING_CONTAMINATION"
    );

    // Correct clean response keeping products distinct
    const cleanResponse =
      "Para diabetes tipo 2, o Ozempic é aprovado nas doses de 0.25 mg, 0.5 mg, 1.0 mg e máxima de 2.0 mg semanais. A dose de 1.7 mg pertence exclusivamente ao escalonamento do Wegovy para obesidade.";

    const passCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "Como funciona a titulação do Ozempic?",
      assistantText: cleanResponse,
      sources: dosingSources,
    });

    assert.strictEqual(passCheck.isValid, true, "Clean response adhering to evidence sources must pass");
  });

  it("4. contradictory approval statement detected before final output", () => {
    // Internally contradictory response
    const contradictoryResponse =
      "A semaglutida não é aprovada para nenhuma indicação médica regulatória no momento. No entanto, é amplamente aprovada pela Anvisa e pelo FDA para diabetes tipo 2 e controle de peso.";

    const failCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "A semaglutida é aprovada?",
      assistantText: contradictoryResponse,
    });

    assert.strictEqual(failCheck.isValid, false, "Must catch mutually incompatible approval claims");
    assert.ok(
      failCheck.violations.some((v) => v.includes("MUTUALLY_INCOMPATIBLE_CLAIMS")),
      "Must flag MUTUALLY_INCOMPATIBLE_CLAIMS"
    );

    // Coherent non-contradictory response
    const coherentResponse =
      "A semaglutida possui aprovação regulatória tanto pelo FDA quanto pela Anvisa para o tratamento do diabetes tipo 2 (sob a marca Ozempic) e controle de peso crônico (sob a marca Wegovy).";

    const passCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "A semaglutida é aprovada?",
      assistantText: coherentResponse,
    });

    assert.strictEqual(passCheck.isValid, true, "Coherent non-contradictory claims must pass");
  });

  it("5. current retatrutide evidence supersedes old conversation answer", () => {
    // Response repeating outdated status claiming no Phase 3 results exist
    const outdatedResponse =
      "A retatrutida é uma molécula tri-agonista promissora, mas os ensaios de fase 3 ainda estão em andamento sem resultados divulgados até o momento.";

    const failCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "Qual é o status atual da retatrutida?",
      assistantText: outdatedResponse,
      sources: dummySources,
    });

    assert.strictEqual(
      failCheck.isValid,
      false,
      "Must fail when claiming Phase 3 has no results while evidence shows 2026 reported results"
    );
    assert.ok(
      failCheck.violations.some((v) => v.includes("CONTRADICTS_SOURCE_CONTEXT")),
      "Must flag CONTRADICTS_SOURCE_CONTEXT"
    );

    // Up-to-date response superseding past beliefs
    const updatedResponse =
      "Diferente de comunicações anteriores durante o desenvolvimento, os estudos de Fase 3 TRIUMPH já apresentaram dados robustos em 2026 comprovando redução de peso de até 24% e melhora de biomarcadores cardiometabólicos.";

    const passCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "Qual é o status atual da retatrutida?",
      assistantText: updatedResponse,
      sources: dummySources,
    });

    assert.strictEqual(passCheck.isValid, true, "Superseding response aligned with current 2026 evidence must pass");
  });

  it("6. Real Pipeline Integration: LOCAL_VAULT_ONLY (Research=SKIPPED) + stale history triggers STALE_PROSE_VS_VAULT, exactly 1 regeneration, and persists corrected Vault state", async () => {
    const userId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const integrationId = crypto.randomUUID();

    const token = await createSessionToken({ userId, username: "dr_tester", role: "ADMIN" });

    const mockUser = { id: userId, username: "dr_tester", role: "ADMIN", allowedModels: ["health-ai"] };
    const mockConv = {
      id: conversationId,
      userId,
      title: "Medication Dose Check",
      activeModel: "health-ai",
      aiIntegrationId: integrationId,
      summary: null,
      summaryData: null,
    };
    const mockIntegration = {
      id: integrationId,
      userId,
      provider: "OMNIRoute",
      baseUrl: "http://127.0.0.1:3001/v1",
      encryptedApiKey: encryptApiKey("mock-secret-key-2026"),
      enabled: true,
      defaultCombo: "health-ai",
      defaultModel: "health-ai",
    };

    (db.user.findUnique as any) = async () => mockUser;
    (db.conversation.findFirst as any) = async () => mockConv;
    (db.conversation.update as any) = async () => mockConv;
    (db.aiIntegration.findFirst as any) = async () => mockIntegration;

    const persistedMessages: any[] = [];
    (db.message.create as any) = async ({ data }: any) => {
      const msg = {
        id: crypto.randomUUID(),
        createdAt: new Date(),
        ...data,
      };
      persistedMessages.push(msg);
      return msg;
    };
    (db.message.findMany as any) = async () => [];
    (db.message.findFirst as any) = async () => null;
    (db.bodyMetric.findFirst as any) = async () => null;

    const loggedAudits: any[] = [];
    (db.auditLog.create as any) = async ({ data }: any) => {
      loggedAudits.push(data);
      return { id: crypto.randomUUID() };
    };

    (HealthService.getSummaryContext as any) = async () => ({
      activeMedications: [
        { name: "Semaglutida", currentDose: "2 mg", frequency: "semanal", version: 3 },
      ],
      activeDiet: null,
      activeRecommendations: [],
      recentMetrics: [],
    });

    (ResearchOrchestrator.execute as any) = async () => ({
      runId: "run-local-vault-01",
      query: "Qual é minha dose atual?",
      queryHash: "hash-vault-01",
      policy: "REQUIRED",
      intent: "LOCAL_VAULT_ONLY",
      sources: [],
      cached: false,
      provider: "none",
      latencyMs: 2,
      status: "SKIPPED",
      vaultResolutionUsed: false,
      resolvedEntityTypes: [],
      resolvedEntityCount: 0,
    });

    let completionCalls = 0;
    (OmniRouteProvider.chatCompletion as any) = async () => {
      completionCalls++;
      if (completionCalls === 1) {
        // First draft: claims 2 mg is pending
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: "A sua dose de 2 mg está pendente de aprovação, portanto seu medicamento atual ainda é 1 mg.",
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 35 },
        };
      } else {
        // Second draft (after regeneration): corrected to live Vault state
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: "Seu registro atual no HealthVault confirma que a Semaglutida está ativa na dose de 2 mg semanal (versão 3 aplicada com sucesso).",
              },
            },
          ],
          usage: { prompt_tokens: 160, completion_tokens: 40 },
        };
      }
    };

    const req = new NextRequest("http://localhost:3000/api/ai/chat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        content: "Qual é minha dose atual?",
        model: "health-ai",
      }),
    });

    const res = await chatPOST(req);
    assert.strictEqual(res.status, 200, "Chat request must succeed");

    const body = await res.json();
    assert.strictEqual(body.success, true);

    // Verification 1: Exactly 1 regeneration (2 total LLM completions)
    assert.strictEqual(completionCalls, 2, "Must perform exactly one consistency regeneration");

    // Verification 2: Gate logged audit failure
    const auditFailure = loggedAudits.find((a) => a.action === "AI_EVIDENCE_CONSISTENCY_GATE_FAILED");
    assert.ok(auditFailure, "Must record consistency gate failure in audit log");
    assert.ok(
      auditFailure.metadata.violations.some((v: string) => v.includes("STALE_PROSE_VS_VAULT")),
      "Audit must contain STALE_PROSE_VS_VAULT violation"
    );

    // Verification 3: Final returned message has corrected content
    assert.ok(
      body.message.content.includes("2 mg semanal"),
      "Final response must reflect active Vault state"
    );
    assert.ok(
      body.message.content.includes("versão 3"),
      "Final response must reflect active Vault version"
    );
    assert.ok(
      !body.message.content.includes("está pendente"),
      "Final response must not contain stale pending claim"
    );

    // Verification 4: Persisted assistant record in database is the corrected response
    const persistedAssistant = persistedMessages.find((m) => m.senderType === "AI");
    assert.ok(persistedAssistant, "Must have persisted AI message");
    assert.ok(
      persistedAssistant.content.includes("2 mg semanal"),
      "Persisted message must be the regenerated, corrected response"
    );
    assert.ok(
      persistedAssistant.content.includes("versão 3"),
      "Persisted message must include the active version"
    );
    assert.ok(
      !persistedAssistant.content.includes("está pendente"),
      "Persisted message must NOT contain initial invalid draft"
    );
  });

  it("7. Real Pipeline Integration: Web Research (sources > 0) + lazy repetition triggers LAZY_REPETITION_REFERENCE, exactly 1 regeneration, and persists fresh synthesis", async () => {
    const userId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const integrationId = crypto.randomUUID();

    const token = await createSessionToken({ userId, username: "dr_tester", role: "ADMIN" });

    const mockUser = { id: userId, username: "dr_tester", role: "ADMIN", allowedModels: ["health-ai"] };
    const mockConv = {
      id: conversationId,
      userId,
      title: "Retatrutide Status",
      activeModel: "health-ai",
      aiIntegrationId: integrationId,
      summary: null,
      summaryData: null,
    };
    const mockIntegration = {
      id: integrationId,
      userId,
      provider: "OMNIRoute",
      baseUrl: "http://127.0.0.1:3001/v1",
      encryptedApiKey: encryptApiKey("mock-secret-key-2026"),
      enabled: true,
      defaultCombo: "health-ai",
      defaultModel: "health-ai",
    };

    (db.user.findUnique as any) = async () => mockUser;
    (db.conversation.findFirst as any) = async () => mockConv;
    (db.conversation.update as any) = async () => mockConv;
    (db.aiIntegration.findFirst as any) = async () => mockIntegration;

    const persistedMessages: any[] = [];
    (db.message.create as any) = async ({ data }: any) => {
      const msg = {
        id: crypto.randomUUID(),
        createdAt: new Date(),
        ...data,
      };
      persistedMessages.push(msg);
      return msg;
    };
    (db.message.findMany as any) = async () => [];
    (db.message.findFirst as any) = async () => null;
    (db.bodyMetric.findFirst as any) = async () => null;

    const loggedAudits: any[] = [];
    (db.auditLog.create as any) = async ({ data }: any) => {
      loggedAudits.push(data);
      return { id: crypto.randomUUID() };
    };

    (HealthService.getSummaryContext as any) = async () => ({
      activeMedications: [],
      activeDiet: null,
      activeRecommendations: [],
      recentMetrics: [],
    });

    (ResearchOrchestrator.execute as any) = async () => ({
      runId: "run-web-research-01",
      query: "Qual é o status atual da retatrutida?",
      queryHash: "hash-web-01",
      policy: "REQUIRED",
      intent: "EXTERNAL_RESEARCH",
      sources: dummySources,
      cached: false,
      provider: "omniroute",
      latencyMs: 15,
      status: "SUCCESS",
      contextBlock: "<web_research>\n[S1] TRIUMPH-1 and TRIUMPH-2 Phase 3 Clinical Trial Results Reported in 2026\n</web_research>",
      vaultResolutionUsed: false,
      resolvedEntityTypes: [],
      resolvedEntityCount: 0,
    });

    let completionCalls = 0;
    (OmniRouteProvider.chatCompletion as any) = async () => {
      completionCalls++;
      if (completionCalls === 1) {
        // First draft: lazy repetition
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: "Como já respondido acima nessa sessão, a resposta completa está acima.",
              },
            },
          ],
          usage: { prompt_tokens: 150, completion_tokens: 25 },
        };
      } else {
        // Second draft (after regeneration): fresh synthesis grounded in sources
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: "Com base nas evidências clínicas mais recentes de 2026 nos ensaios TRIUMPH de Fase 3, a retatrutida demonstrou resultados expressivos de eficácia e segurança na redução de peso.",
              },
            },
          ],
          usage: { prompt_tokens: 210, completion_tokens: 45 },
        };
      }
    };

    const req = new NextRequest("http://localhost:3000/api/ai/chat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        content: "Qual é o status atual da retatrutida?",
        model: "health-ai",
      }),
    });

    const res = await chatPOST(req);
    assert.strictEqual(res.status, 200, "Chat request must succeed");

    const body = await res.json();
    assert.strictEqual(body.success, true);

    // Verification 1: Exactly 1 regeneration (2 total completions)
    assert.strictEqual(completionCalls, 2, "Must perform exactly one consistency regeneration on lazy repetition");

    // Verification 2: Gate logged audit failure with LAZY_REPETITION_REFERENCE
    const auditFailure = loggedAudits.find((a) => a.action === "AI_EVIDENCE_CONSISTENCY_GATE_FAILED");
    assert.ok(auditFailure, "Must record consistency gate failure in audit log");
    assert.ok(
      auditFailure.metadata.violations.some((v: string) => v.includes("LAZY_REPETITION_REFERENCE")),
      "Audit must contain LAZY_REPETITION_REFERENCE violation"
    );

    // Verification 3: Final returned message contains fresh synthesis
    assert.ok(
      body.message.content.includes("TRIUMPH de Fase 3"),
      "Final response must contain fresh synthesis grounded in 2026 evidence"
    );
    assert.ok(
      !body.message.content.includes("já respondido acima"),
      "Final response must not contain lazy repetition"
    );

    // Verification 4: Persisted assistant record in database is the fresh synthesis
    const persistedAssistant = persistedMessages.find((m) => m.senderType === "AI");
    assert.ok(persistedAssistant, "Must have persisted AI message");
    assert.ok(
      persistedAssistant.content.includes("TRIUMPH de Fase 3"),
      "Persisted message must be the fresh synthesis"
    );
    assert.ok(
      !persistedAssistant.content.includes("já respondido acima"),
      "Persisted message must NOT contain lazy draft"
    );
  });
});
