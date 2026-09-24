# HealthVault AI — System Architecture Specification

## 1. System Overview & Core Purpose

**HealthVault AI** is a self-hosted, personal health knowledge base, conversation archive, and clinical recommendation versioning system. It bridges the gap between unstructured, iterative health conversations (conducted with AI agents, medical professionals, or recorded as self-notes) and structured, auditable health records.

### Core Philosophy
1. **Never Silently Overwrite**: Any modification to clinical dosage, medication schedules, macronutrient targets, or recommendations generates an immutable new version linked directly to the origin conversation.
2. **Clinical Safety by Design**: AI suggestions are visually and semantically quarantined from certified medical prescriptions. Recommendations carry explicit provenance, author categorization (`AI`, `Doctor`, `User`), and status markers (`draft`, `AI suggestion`, `doctor recommendation`, `user note`, `confirmed`, `archived`).
3. **Conversational Dual-Layer Model**:
   - **Layer 1: Verbatim Conversation History**: Raw, chronological dialogue rendered in a modern chat interface (supporting markdown, attachments, metadata, and message revisions).
   - **Layer 2: Consolidated Recommendation Snapshot**: A living, structured snapshot ("Latest Recommendation") summarizing active medications, current nutritional targets, symptoms, and review deadlines.

---

## 2. System Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        User Web Browser / PWA                          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS (TLS Termination)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Edge Network                         │
│                    (Zero Trust Tunnel / Ingress)                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Encrypted Tunnel (cloudflared-b)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│             LXC / Docker — healthvault (3000)                         │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     Next.js 14 Web Application                   │  │
│  │  ┌─────────────────────────┐      ┌───────────────────────────┐  │  │
│  │  │  App Router & UI        │      │   API Routes / Handlers   │  │  │
│  │  │  - Chat Messenger       │◄────►│   - /api/auth             │  │  │
│  │  │  - Recommendation Panel │      │   - /api/conversations    │  │  │
│  │  │  - Version Diff Viewer  │      │   - /api/messages         │  │  │
│  │  │  - Health Dashboard     │      │   - /api/recommendations  │  │  │
│  │  │  - Timeline & Metrics   │      │   - /api/medications      │  │  │
│  │  └─────────────────────────┘      │   - /api/diets            │  │  │
│  │                                   │   - /api/health           │  │  │
│  │                                   │   - /api/audit            │  │  │
│  │                                   └─────────────┬─────────────┘  │  │
│  └─────────────────────────────────────────────────┼────────────────┘  │
│                                                    │ Prisma ORM        │
│                                                    ▼                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                  PostgreSQL Database Engine                      │  │
│  │  - Relational Integrity (Foreign Keys & Cascades)                │  │
│  │  - Immutable History Tables (_versions)                          │  │
│  │  - Audit Log Append-Only Ledger                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                  Local Persistent Storage                        │  │
│  │  - /var/lib/postgresql/data (Database Data)                      │  │
│  │  - /var/www/healthvault/uploads (Document Attachments & Labs)    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Relational Database Schema & Entities

The relational schema is enforced via **Prisma ORM** targeting **PostgreSQL**.

### Key Entity Graph

```text
User (1)
  ├── (N) Conversation
  │     ├── (N) Message ─── (N) MessageVersion
  │     ├── (N) Recommendation ─── (N) RecommendationVersion
  │     │     └── (N) Medication ─── (N) MedicationVersion
  │     └── (N) Attachment
  ├── (N) DietPlan
  │     ├── (N) DietVersion
  │     └── (N) Meal ─── (N) MealFood ─── (1) Food
  ├── (N) BodyMetric
  ├── (N) Symptom
  ├── (N) LabTest
  ├── (N) Reminder
  └── (N) AuditLog
```

### Table Definitions & Attributes

1. **`users`**:
   - `id` (UUID, PK), `email` (unique), `username`, `password_hash` (Argon2id), `full_name`, `created_at`, `updated_at`, `last_login_at`.
2. **`conversations`**:
   - `id` (UUID, PK), `user_id` (FK), `title`, `summary` (JSON structured summary), `is_favorite` (bool), `is_archived` (bool), `tags` (string[]), `created_at`, `updated_at`.
3. **`messages`**:
   - `id` (UUID, PK), `conversation_id` (FK), `sender_type` (USER | AI | SYSTEM), `sender_name`, `content` (markdown), `metadata` (JSON), `is_edited` (bool), `created_at`, `updated_at`.
4. **`message_versions`**:
   - `id` (UUID, PK), `message_id` (FK), `version_number` (int), `content`, `edited_by`, `reason`, `created_at`.
5. **`recommendations`**:
   - `id` (UUID, PK), `conversation_id` (FK, nullable), `title`, `status` (`DRAFT`, `AI_SUGGESTION`, `DOCTOR_RECOMMENDATION`, `USER_NOTE`, `CONFIRMED`, `ARCHIVED`), `source_type` (`AI_AGENT`, `DOCTOR`, `USER_NOTE`, `LAB_REPORT`), `source_name`, `ai_model`, `notes`, `current_version` (int), `created_at`, `updated_at`.
6. **`recommendation_versions`**:
   - `id` (UUID, PK), `recommendation_id` (FK), `version_number` (int), `status`, `summary_snapshot` (JSON: active meds, diet targets, precautions), `change_reason`, `conversation_id` (FK), `created_by`, `created_at`.
7. **`medications`**:
   - `id` (UUID, PK), `recommendation_id` (FK, nullable), `user_id` (FK), `name`, `generic_name`, `brand_name`, `category`, `form` (pill, injection, liquid), `is_active` (bool), `created_at`, `updated_at`.
8. **`medication_versions`**:
   - `id` (UUID, PK), `medication_id` (FK), `version_number` (int), `dose_value` (float), `dose_unit` (mg, mcg, IU, ml), `frequency` (e.g., 1x/day, weekly), `schedule` (morning, with meal), `route` (oral, subq), `start_date`, `end_date`, `change_reason`, `conversation_id` (FK, nullable), `created_at`.
9. **`diet_plans`**:
   - `id` (UUID, PK), `user_id` (FK), `title`, `goal` (fat loss, hypertrophy, maintenance), `is_active` (bool), `created_at`, `updated_at`.
10. **`diet_versions`**:
    - `id` (UUID, PK), `diet_plan_id` (FK), `version_number` (int), `target_calories` (int), `target_protein_g` (float), `target_carbs_g` (float), `target_fat_g` (float), `change_reason`, `conversation_id` (FK, nullable), `created_at`.
11. **`meals`** & **`foods`**:
    - `meals`: `id`, `diet_version_id`, `name` (Breakfast, Lunch, Dinner, Snack), `scheduled_time`.
    - `foods`: `id`, `name`, `calories_per_100g`, `protein_per_100g`, `carbs_per_100g`, `fat_per_100g`.
    - `meal_foods`: `id`, `meal_id`, `food_id`, `portion_g`.
12. **`body_metrics`**:
    - `id`, `user_id`, `date`, `weight_kg`, `body_fat_pct`, `muscle_mass_kg`, `waist_cm`, `chest_cm`, `notes`, `conversation_id`.
13. **`symptoms`**:
    - `id`, `user_id`, `symptom`, `severity` (1-10), `date`, `start_time`, `end_time`, `description`, `possible_trigger`, `medication_id` (FK), `conversation_id` (FK).
14. **`lab_tests`**:
    - `id`, `user_id`, `test_name`, `category` (Blood, Lipid, Hormone, Metabolic), `test_date`, `marker_name`, `result_value`, `unit`, `reference_range_low`, `reference_range_high`, `flag` (NORMAL | HIGH | LOW), `conversation_id`.
15. **`attachments`**:
    - `id`, `user_id`, `conversation_id`, `filename`, `file_path`, `mime_type`, `file_size`, `hash_sha256`, `created_at`.
16. **`audit_logs`**:
    - `id`, `timestamp`, `action`, `entity`, `entity_id`, `user_id`, `ip_address`, `user_agent`, `metadata` (JSON).

---

## 4. Folder Structure

```text
D:\projetos\health-info\
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.mjs
├── architecture.md
├── security.md
├── deployment.md
├── backup-restore.md
├── README.md
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts
│   └── migrations/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx (Dashboard)
│   │   ├── login/page.tsx
│   │   ├── conversations/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx (Chat + Live Recommendation panel)
│   │   ├── recommendations/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx (Version Diff & Details)
│   │   ├── medications/
│   │   │   └── page.tsx (Active meds & Dosage history)
│   │   ├── diet/
│   │   │   └── page.tsx (Meal plans, macros & diet versions)
│   │   ├── health/
│   │   │   ├── metrics/page.tsx (Weight & Body metrics)
│   │   │   ├── symptoms/page.tsx (Symptom logger)
│   │   │   └── labs/page.tsx (Lab tests & Biomarkers)
│   │   ├── timeline/page.tsx (Unified Chronological Evolution)
│   │   ├── audit/page.tsx (Audit logs viewer)
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── login/route.ts
│   │       │   ├── logout/route.ts
│   │       │   ├── me/route.ts
│   │       │   └── change-password/route.ts
│   │       ├── conversations/
│   │       │   ├── route.ts
│   │       │   └── [id]/
│   │       │       ├── route.ts
│   │       │       └── messages/route.ts
│   │       ├── messages/
│   │       │   └── [id]/route.ts
│   │       ├── recommendations/
│   │       │   ├── route.ts
│   │       │   └── [id]/
│   │       │       ├── route.ts
│   │       │       └── versions/route.ts
│   │       ├── medications/
│   │       │   ├── route.ts
│   │       │   └── [id]/
│   │       │       ├── route.ts
│   │       │       └── versions/route.ts
│   │       ├── diets/
│   │       │   ├── route.ts
│   │       │   └── [id]/
│   │       │       ├── route.ts
│   │       │       └── versions/route.ts
│   │       ├── health/
│   │       │   ├── metrics/route.ts
│   │       │   ├── symptoms/route.ts
│   │       │   └── labs/route.ts
│   │       ├── timeline/route.ts
│   │       ├── audit/route.ts
│   │       └── health/route.ts (System Healthcheck)
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── AppShell.tsx
│   │   ├── chat/
│   │   │   ├── ChatContainer.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── MessageInput.tsx
│   │   │   └── RecommendationDrawer.tsx
│   │   ├── recommendations/
│   │   │   ├── CurrentRecommendationCard.tsx
│   │   │   ├── VersionHistoryModal.tsx
│   │   │   ├── VersionDiffViewer.tsx
│   │   │   └── SafetyBadge.tsx
│   │   ├── ui/ (Button, Input, Card, Modal, Badge, Toast, Table)
│   ├── lib/
│   │   ├── db.ts (Prisma client singleton)
│   │   ├── auth.ts (Argon2id hashing, JWT token generation & verification)
│   │   ├── session.ts (HttpOnly cookie session manager)
│   │   ├── audit.ts (Audit logger service)
│   │   ├── diff.ts (Clinical diff calculator for dosages and diet)
│   │   └── security.ts (Rate limiter & CSRF utilities)
└── tests/
    ├── unit/
    │   ├── diff.test.ts
    │   ├── auth.test.ts
    │   └── versioning.test.ts
    └── integration/
        ├── auth-api.test.ts
        ├── conversations-api.test.ts
        └── recommendations-api.test.ts
```

---

## 5. API Design & Versioning Strategy

All endpoints enforce JSON input validation, authentication guard, and audit logging.

| Endpoint | Method | Description |
|---|---|---|
| `/api/auth/login` | POST | Authenticates user with username/password, sets HttpOnly cookie |
| `/api/auth/logout` | POST | Clears session cookie and writes `LOGOUT` audit event |
| `/api/auth/me` | GET | Returns current user profile (id, username, email) |
| `/api/conversations` | GET, POST | List conversations (filter by tag, favorite) / Create conversation |
| `/api/conversations/[id]` | GET, PUT, DELETE | Retrieve conversation with messages / Update metadata / Soft delete |
| `/api/conversations/[id]/messages` | GET, POST | Fetch conversation messages / Send new message (User or AI) |
| `/api/messages/[id]` | PUT, DELETE | Edit message (generates `MessageVersion`) / Delete message |
| `/api/recommendations` | GET, POST | List recommendations / Create recommendation |
| `/api/recommendations/[id]` | GET, PUT | Get recommendation snapshot / Update recommendation (creates new `RecommendationVersion`) |
| `/api/recommendations/[id]/versions`| GET | List all immutable historical versions of recommendation |
| `/api/medications` | GET, POST | List active medications / Create medication |
| `/api/medications/[id]/versions` | POST, GET | Create new dosage version / View dosage evolution history |
| `/api/diets` | GET, POST | List diet plans / Create diet plan |
| `/api/diets/[id]/versions` | POST, GET | Update macro targets (creates `DietVersion`) / View diet history |
| `/api/health/metrics` | GET, POST | Log and fetch body weight & composition metrics |
| `/api/health/symptoms` | GET, POST | Log and fetch symptoms with severity 1-10 and correlations |
| `/api/health/labs` | GET, POST | Log and fetch lab test results & biomarker flags |
| `/api/timeline` | GET | Consolidated timeline across medications, diet, symptoms, and labs |
| `/api/audit` | GET | Read-only access to audit trail |
| `/api/health` | GET | System liveness and database connectivity healthcheck |

### Versioning Rules
1. **Append-Only History**: Records in `medication_versions`, `recommendation_versions`, `diet_versions`, and `message_versions` are strictly append-only.
2. **Back-Link to Provenance**: Each version stores an optional `conversation_id` and `change_reason`, linking changes directly to the conversation turn that motivated them.
3. **No Phantom Updates**: Calling `PUT` on a medication or recommendation never overwrites existing dosage or macro fields; it writes a new version with an incremented `version_number` and sets the previous version's supersession timestamp.

---

## 6. UI Page Map & Clinical UX Principles

```text
/ (Dashboard)
├── Quick Stats: Active Meds, Current Diet, Latest Weight, Upcoming Reviews
├── Latest Conversation Card
├── Latest Recommendation Snapshot
└── Recent Health Events Timeline

/conversations
├── Sidebar: Search, Favorites, Filter by Tag/Origin
├── Chat View: WhatsApp/ChatGPT modern message flow
│   ├── User Bubble (right)
│   ├── AI Agent Bubble (left, clearly designated)
│   └── In-line Message Actions (View edits, Link to recommendation)
└── Pinned Recommendation Drawer:
    ├── Current Active Medications (with dosage & frequency)
    ├── Daily Nutrition Target (Calories & Macros)
    └── [View History & Diff] Button

/recommendations
├── List of Recommendations (categorized by status & source)
└── Details View:
    ├── Side-by-side version comparison
    ├── Dose changes highlighted in green (+)/red (-)
    └── Origin conversation link

/medications
├── Active Medications Cards
├── Dosage Timeline (graph & table of dose changes over time)
└── Add/Adjust Dose Modal (mandates reason & origin)

/diet
├── Current Diet Plan & Meal Timing
├── Macro distribution breakdown
└── Nutrition Version History

/health
├── Body Metrics: Weight & body fat tracking with trend chart
├── Symptoms Log: Severity scale (1-10) & trigger correlations
└── Lab Results: Biomarker reference range visualizer (Normal/High/Low)

/timeline
└── Unified chronological feed:
    - "Sep 24: Medication A adjusted (7.5 mg → 10 mg)"
    - "Sep 22: Blood test lipid panel added"
    - "Sep 20: Weight updated to 82.4 kg"

/audit
└── System activity log (Login, Data changes, Export operations)
```

---

## 9. Web-First Research & Exploit Hardening

HealthVault enforces a server-side **Web-First Policy** for the `exploit` combo and any models whose training knowledge may be outdated for external factual data:

```text
User Message
     │
     ▼
ResearchPolicy Resolver ────────► REQUIRED (exploit) / AUTO (others)
     │
     ▼
ResearchIntentAnalyzer
     ├── LOCAL_VAULT_ONLY ─────► Zero external calls; uses HealthVault local tools
     └── EXTERNAL_KNOWLEDGE ───► Dispatches Web Research Preflight
                                       │
                                       ▼
                       SearXNG (Homelab LXC 131) / Brave Search
                                       │
                                       ▼
                       SourceRanking (Tier 1 PubMed/FDA/ANVISA prioritised)
                                       │
                                       ▼
                       ResearchContextBuilder (<web_research> sanitised)
                                       │
                                       ▼
                       OmniRoute / exploit (Grounded answer formulation)
                                       │
                                       ▼
                       AssistantResponseProcessor (Reasoning stripped)
                                       │
                                       ▼
                       Final UI response with collapsible verified citations
```

### Key Safety Invariants:
1. **Tool-Loop Sanitization**: Leaked `<thinking>` or `<think>` tags inside intermediate assistant messages are sanitized before re-injection into subsequent tool-loop iterations.
2. **Telemetry Accuracy**: Usage and reasoning token metrics are captured from the root `completion.usage` payload, ensuring accurate token logging without storing textual reasoning.
3. **Fail-Closed Guarantee**: For `exploit`, if web research fails or no reliable medical sources are found, HealthVault refuses silent fallback to the model's internal memory and returns a controlled, actionable message.
4. **Authoritative Evidence First**: All web sources are classified into Tier 1 (regulatory & indexed literature), Tier 2 (academic centers), Tier 3 (secondary references), and Tier 4 (anecdotal/community), with anecdotal sources explicitly flagged and barred from serving as primary basis for dosing.
