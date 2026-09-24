# HealthVault AI — Personal Health Knowledge & Recommendation Manager

**HealthVault AI** is a self-hosted, personal health knowledge base and conversation manager designed for homelab deployments. It provides an intuitive chat interface for health consultations with AI agents while strictly preserving clinical safety, provenance, and immutable versioning for all recommendations, medications, and dietary adjustments.

---

## 🌟 Key Features

1. **Dual-Layer Conversation Model**:
   - **Full History Layer**: WhatsApp/Messenger-style interface with user and AI speech bubbles, markdown support, and message edit tracking.
   - **Living Snapshot Layer**: Pinned "Latest Recommendation" panel displaying active medications, current nutritional targets, and next review dates.
2. **Immutable Versioning**:
   - Dosages, frequencies, and macronutrient targets are never silently overwritten.
   - Every adjustment generates a versioned entry (`v1`, `v2`, `v3`...) linked to the conversation turn and clinical rationale.
   - Side-by-side Visual Diff comparison with highlighted additions, adjustments, and subtractions.
3. **Clinical Safety UX**:
   - Explicit badges separating `AI Suggestion` from `Doctor Recommendation` and `User Note`.
   - Distinct amber warning banners on unconfirmed AI outputs (`⚠️ AI-generated suggestion — not medical prescription`).
4. **AI Agent & OmniRoute Integration**:
   - Seamless connection to OmniRoute (e.g. `https://omniroute.example.com/v1`) with model/combo discovery (e.g. `demigod-flash`).
   - Server-side Tool Dispatcher supporting 12+ structured actions (updating medications, adjusting diet macros, recording symptoms and metrics).
   - Configurable AI Write Policies (`Auto Apply` vs `Review First`) with interactive in-chat approval proposals.
   - AES-256-GCM encrypted API key storage with zero frontend exposition.
5. **Comprehensive Health Records**:
   - Medication tracker with titration timelines.
   - Nutrition and meal planning with caloric and macronutrient targets.
   - Body metrics (weight, body fat %, muscle mass, measurements).
   - Symptom logger with 1-10 severity scale and medication correlation.
   - Lab tests and biomarker reference ranges.
5. **Security & Auditing**:
   - Zero-trust architecture designed for Cloudflare Tunnel ingress.
   - Argon2id / Bcrypt password hashing + secure `HttpOnly` session cookies.
   - Brute-force rate limiting and append-only `audit_logs` table.
   - Zero unauthenticated API routes (except login and healthcheck).

---

## 🏗️ Architecture & Technology Stack

- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS, Lucide Icons.
- **Backend**: Next.js API Route Handlers, Zod validation, Jose (JWT).
- **Database & ORM**: PostgreSQL 16/17 + Prisma ORM.
- **Infrastructure**: Proxmox VE unprivileged LXC or Docker container (`healthvault:3000`).
- **Ingress**: Reverse Proxy / Cloudflare Tunnel / Tailscale.

---

## 🚀 Deployment

### Homelab Deployment Configuration
- **Host**: Proxmox VE / Linux Host / Docker
- **Default Port**: `3000`

### Cloudflare Tunnel Setup
1. In Cloudflare Zero Trust Dashboard, select your tunnel.
2. Add Public Hostname:
   - **Domain**: e.g., `health.example.com`
   - **Service Type**: `HTTP`
   - **URL**: `http://<CONTAINER_IP>:3000`
3. Save. Cloudflare terminates external TLS and routes traffic directly into the private container.

### Running with Docker Compose
```bash
cp .env.example .env
# Edit .env with your desired secrets
docker compose up -d
```

### Local Development
```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env

# 3. Generate Prisma client & apply database schema
npx prisma generate
npx prisma db push

# 4. Seed initial clinical data
npx tsx prisma/seed.ts

# 5. Start dev server
pnpm dev
```

Default seeded credentials (change immediately upon deployment):
- **Username**: `admin`
- **Password**: `HealthVault2026!ChangeMe`

---

## 🧪 Testing

Run automated unit and integration tests:
```bash
pnpm test
```

---

## 🔒 Security Posture & Documentation

Detailed engineering specifications are available in the repository:
- [System Architecture](architecture.md)
- [Security Threat Model](security.md)
- [Deployment Guide](deployment.md)
- [Backup & Disaster Recovery](backup-restore.md)
