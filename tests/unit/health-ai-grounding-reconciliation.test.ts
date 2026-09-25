import { describe, it } from "node:test";
import assert from "node:assert";
import { EvidenceConsistencyGate } from "../../src/lib/ai/response/evidence-consistency-gate";
import { SearchResult } from "../../src/lib/ai/research/types";

describe("health-ai — Fresh Evidence Grounding & Current-State Reconciliation", () => {
  const dummySources: SearchResult[] = [
    {
      id: "S1",
      title: "TRIUMPH-1 and TRIUMPH-2 Phase 3 Clinical Trial Results Reported in 2026",
      url: "https://clinicaltrials.gov/study/NCT06383390",
      snippet: "Phase 3 clinical trial results published demonstrating substantial weight reduction and glycemic control for retatrutide.",
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

    assert.strictEqual(gateCheck.isValid, false, "Must fail consistency check when assistant lazily refers to previous messages");
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

    assert.strictEqual(failCheck.isValid, false, "Must flag violation when assistant claims dose is pending despite Vault showing active");
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

  it("3. Ozempic titration must not inherit Wegovy 1.7 mg step", () => {
    // Contaminated response mixing Wegovy step into Ozempic
    const contaminatedResponse =
      "O esquema de titulação do Ozempic inicia em 0.25 mg, passando para 0.5 mg, 1.0 mg, depois 1.7 mg e no máximo 2.0 mg.";

    const failCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "Como funciona a titulação do Ozempic?",
      assistantText: contaminatedResponse,
    });

    assert.strictEqual(failCheck.isValid, false, "Must detect cross-product dosing contamination");
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
    });

    assert.strictEqual(passCheck.isValid, true, "Product-distinct titration must pass");
  });

  it("4. contradictory approval statement detected before final output", () => {
    // Contradictory claims: 'not approved for any indication' vs 'Ozempic 2 mg is FDA-approved'
    const contradictoryResponse =
      "A dosagem de 2 mg não é aprovada para nenhuma indicação clínica. No entanto, o Ozempic 2 mg é aprovado pela FDA para controle do diabetes.";

    const failCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "A dose de 2 mg é aprovada?",
      assistantText: contradictoryResponse,
    });

    assert.strictEqual(failCheck.isValid, false, "Must detect mutually contradictory approval claims");
    assert.ok(
      failCheck.violations.some((v) => v.includes("MUTUALLY_INCOMPATIBLE_CLAIMS")),
      "Must flag MUTUALLY_INCOMPATIBLE_CLAIMS"
    );

    // Coherent non-contradictory statement
    const coherentResponse =
      "A dose de 2.0 mg de semaglutida é aprovada pela FDA e ANVISA sob o nome comercial Ozempic para o tratamento do diabetes tipo 2. Para obesidade, o produto aprovado é o Wegovy até 2.4 mg.";

    const passCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "A dose de 2 mg é aprovada?",
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

    assert.strictEqual(failCheck.isValid, false, "Must fail when claiming Phase 3 has no results while evidence shows 2026 reported results");
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
});
