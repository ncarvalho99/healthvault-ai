# HealthVault Agent Tool Runtime — Architecture & Specification

## 1. Overview & Purpose

The **HealthVault Agent Tool Runtime** establishes a secure, structured runtime layer enabling AI models (accessed through OpenAI-compatible gateways like **OmniRoute**) to query and modify personal health records.

### Core Philosophy
1. **Zero Route Exposition**: The AI model **never** learns internal REST routes (such as `/api/medications/:id` or `/api/diets`).
2. **Zero Direct DB Access**: The model receives no SQL, no Prisma access, and no administrative tokens.
3. **Structured Tool Calling Only**: Actions are initiated exclusively through structured, schema-validated tool calls (`tool_calls`).
4. **Mandatory Versioning & Provenance**: Any medication dose change, diet adjustment, or recommendation update creates an immutable version linked to the originating conversation.
5. **Human Approval Workflow**: High-risk or policy-configured actions (e.g. medication changes, dosage titration) pause and present an interactive approval card in chat.

---

## 2. Runtime Execution Flow

```text
User Input in Chat
       ↓
ContextBuilder (Assembles strict system prompt + delimited health records data)
       ↓
ToolSelector (Selects scoped tool definitions based on conversation intent)
       ↓
POST OmniRoute /v1/chat/completions (model: exploit / demigod-flash, tools: [...])
       ↓
LLM emits structured tool_calls
       ↓
HealthVault Tool Dispatcher
       ├── 1. Idempotency Check (prevents duplicates on stream retries)
       ├── 2. Permission Engine (verifies access, risk level, enabled status)
       ├── 3. Zod Schema Validation (strictly checks types, positive values, non-empty clinical reasons)
       ├── 4. Approval Engine (checks AiWritePolicy: AUTO_APPLY vs REVIEW_FIRST)
       │        ├── REVIEW_FIRST: records PENDING_APPROVAL and generates in-chat approval card
       │        └── AUTO_APPLY: executes Domain Services
       ├── 5. Domain Service Transaction (creates MedicationVersion, DietVersion, updates parent)
       └── 6. Audit & Timeline Logging
       ↓
Tool Results fed back as role=tool messages
       ↓
LLM generates conversational explanation of action taken
       ↓
Rendered in Browser (Interactive cards, version link, toast confirmations)
```

---

## 3. Tool Catalog & Capabilities

| Tool Name | Category | Access | Risk | Approval Policy | Description |
|---|---|---|---|---|---|
| `healthvault_ping` | `system` | read | low | Auto | Capability handshake to test tool calling support |
| `healthvault_get_context` | `context` | read | low | Auto | Retrieves clinical data snapshots by category |
| `healthvault_list_medications` | `medications` | read | low | Auto | Lists active medications, forms and doses |
| `healthvault_get_medication` | `medications` | read | low | Auto | Retrieves details for a specific medication |
| `healthvault_get_medication_history`| `medications` | read | low | Auto | Retrieves versioned dosage history |
| `healthvault_create_medication` | `medications` | write | high | Policy (`REVIEW_FIRST` default) | Initiates a new medication with baseline dosage |
| `healthvault_update_medication` | `medications` | write | high | Policy (`REVIEW_FIRST` default) | Adjusts dose, frequency, creating `MedicationVersion` |
| `healthvault_stop_medication` | `medications` | write | high | Policy (`REVIEW_FIRST` default) | Discontinues medication with recorded clinical reason |
| `healthvault_get_current_diet` | `nutrition` | read | low | Auto | Returns current caloric target and macro distribution |
| `healthvault_get_diet_history` | `nutrition` | read | low | Auto | Returns history of dietary versions |
| `healthvault_create_diet` | `nutrition` | write | medium | Policy (`AUTO_APPLY` default) | Creates a new nutritional plan |
| `healthvault_update_diet` | `nutrition` | write | medium | Policy (`AUTO_APPLY` default) | Adjusts calories/macros, creating `DietVersion` |
| `healthvault_list_foods` | `nutrition` | read | low | Auto | Searches nutritional database |
| `healthvault_create_food` | `nutrition` | write | low | Auto | Adds a food item with macros per 100g |
| `healthvault_get_body_metrics` | `metrics` | read | low | Auto | Retrieves weight and body fat measurements |
| `healthvault_add_body_metric` | `metrics` | write | low | Policy (`AUTO_APPLY` default) | Records weight, body fat %, or circumference |
| `healthvault_list_symptoms` | `symptoms` | read | low | Auto | Lists recorded symptoms and side effects |
| `healthvault_add_symptom` | `symptoms` | write | low | Policy (`AUTO_APPLY` default) | Records symptom with 1–10 severity scale |
| `healthvault_list_lab_results` | `labs` | read | low | Auto | Lists biomarker results and reference ranges |
| `healthvault_add_lab_result` | `labs` | write | medium | Policy (`REVIEW_FIRST` default) | Records lab test analyte measurement |
| `healthvault_create_reminder` | `reminders` | write | low | Auto | Schedules review dates on dashboard |
| `healthvault_get_timeline` | `timeline` | read | low | Auto | Returns chronological evolution of health events |

---

## 4. Security & Hardening Boundaries

1. **Prompt Injection Boundary**:
   - Patient notes, symptom triggers, and historical records are strictly quarantined inside `<healthvault_data><records>...</records></healthvault_data>`.
   - The LLM is instructed that all stored content represents historical user data, not system rules.
2. **Infinite Loop Protection**:
   - `MAX_TOOL_ITERATIONS = 8`.
   - Repetition detection terminates the loop if the assistant requests identical tool calls with identical arguments in sequence.
3. **No Destructive Tools**:
   - The registry intentionally provides zero tools for account deletion, purge history, drop tables, restore backups, or alter system security settings.
4. **Idempotency Guarantee**:
   - Unique tracking via `toolCallId` ensures retried completions do not produce phantom versions.
