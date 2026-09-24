# HealthVault AI — OmniRoute & AI Agent Integration Guide

## 1. Overview & Architecture

HealthVault AI is integrated directly with **OmniRoute** (OpenAI-compatible AI gateway) to transform the chat interface into an active clinical assistant capable of reading and modifying health records via structured tool calls.

### Core Architecture Flow

```text
Browser / Web Client
       ↓ HTTPS (Cookie Authenticated)
HealthVault Next.js Backend
       ↓
  1. ContextBuilder (Prepares strict system prompt & health data snapshot)
  2. OmniRoute Provider (Calls POST /v1/chat/completions with tools)
       ↓
OmniRoute Gateway (e.g. https://omniroute.example.com/v1)
       ↓
LLM (e.g. demigod-flash)
       ↓ Returns tool_calls
HealthVault Backend
       ↓
  3. Tool Dispatcher
       ├── Validates parameters via Zod schemas
       ├── Checks AI Write Policy (Auto Apply vs Review First)
       ├── Executes Domain Services inside database transactions
       ├── Creates immutable versions (MedicationVersion, DietVersion, etc.)
       └── Appends audit log entries
       ↓ Loops tool outputs back to LLM
OmniRoute Gateway
       ↓ Returns final assistant message
HealthVault Backend
       ↓
Browser (Live in-chat updates & approval proposals)
```

---

## 2. Security & Credentials Protection

1. **Zero Client-Side Exposition**: The OmniRoute API key is encrypted using **AES-256-GCM** with a 96-bit random IV and 128-bit authentication tag.
2. **Server-Side Proxy**: Browsers never communicate directly with OmniRoute; all calls originate from the HealthVault container backend.
3. **SSRF Guard**: Endpoints are strictly validated to use only HTTP/HTTPS protocols with custom request timeouts.
4. **Prompt Injection Boundary**: Stored medical data is encapsulated inside `<healthvault_data>` tags and marked as untrusted data, preventing stored user notes from hijacking system instructions.
5. **No Blind Code Execution**: The AI agent cannot execute arbitrary SQL queries or delete historical audit/version rows.

---

## 3. AI Write Policies & Approval Workflow

In **Configurações > Configurações de IA**, operators can configure how tool calls are applied:

| Category | Default Policy | Behavior |
|---|---|---|
| **Recomendações Clínicas** | `AUTO_APPLY` | Updates recommendation snapshot and version automatically |
| **Nutrição & Dieta** | `AUTO_APPLY` | Adjusts daily calories and macros, creating a new diet version |
| **Medidas & Peso** | `AUTO_APPLY` | Registers weight and body fat measurements directly |
| **Sintomas & Reações** | `AUTO_APPLY` | Records symptoms with 1-10 severity scale |
| **Exames Laboratoriais** | `REVIEW_FIRST` | Proposes biomarker entry; requires manual click in chat |
| **Medicamentos** | `REVIEW_FIRST` | Proposes new drug initiation; requires manual confirmation |
| **Ajustes de Dosagem** | `REVIEW_FIRST` | Proposes dose changes (e.g. 0.25mg -> 0.5mg); requires manual confirmation |

### Review First Flow
When a tool is subject to `REVIEW_FIRST`:
1. The tool dispatcher records a pending `AiToolExecution` row (`status: PENDING_APPROVAL`).
2. An interactive proposal card appears in the chat stream.
3. The user clicks **Aprovar & Gravar no Vault** or **Rejeitar**.
4. On approval, the domain service runs in an isolated transaction, increments the version number, and logs the human approver.

---

## 4. Supported AI Tools

- `healthvault_get_context`: On-demand querying of medications, diet, recommendations, metrics, symptoms, or labs.
- `healthvault_list_medications`: Lists active medications and schedules.
- `healthvault_create_medication`: Initiates a new medication with baseline dosage.
- `healthvault_update_medication`: Adjusts medication dose or frequency (creates `MedicationVersion`).
- `healthvault_stop_medication`: Safely discontinues a medication with recorded reason.
- `healthvault_get_current_diet`: Returns caloric targets and macronutrient breakdown.
- `healthvault_update_diet`: Updates daily calories, protein, carbs, and fat (creates `DietVersion`).
- `healthvault_create_recommendation`: Formulates a new clinical snapshot.
- `healthvault_add_body_metric`: Records weight and body composition.
- `healthvault_add_symptom`: Records symptoms with 1-10 severity scale.
- `healthvault_add_lab_result`: Records biomarker laboratory tests and reference ranges.
- `healthvault_create_reminder`: Schedules review dates.
