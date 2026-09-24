# HealthVault AI — Security Architecture & Threat Model

## 1. Overview & Trust Boundaries

HealthVault AI manages sensitive personal health information (PHI), clinical recommendations, medication dosages, lab results, and private health dialogues. As a self-hosted single-user application exposed via Cloudflare Tunnel, security focuses on robust defense-in-depth, zero-trust perimeter integration, complete auditability, and clinical safety.

### Trust Boundaries
1. **Edge Boundary**: Reverse proxy / Cloudflare Edge terminates public HTTPS and tunnels traffic to the HealthVault application container (`http://localhost:3000`).
2. **Application Boundary**: Next.js App Router enforces authentication middleware, CSRF validation, and input sanitization before requests reach business logic.
3. **Database Boundary**: PostgreSQL accepts connections only over internal loopback/container network (`127.0.0.1` or Docker bridge), never bound to public interfaces.
4. **Agent Integration Boundary**: Future AI agents connecting via API must present scoped API tokens, undergo strict rate limiting, and all modifications are recorded under `actor_type = AI` with mandatory version creation.

---

## 2. Threat Model (STRIDE Methodology)

| Threat Category | Potential Attack Vector | Mitigations Implemented |
|---|---|---|
| **Spoofing** | Session hijacking, credential stuffing, forged AI agent calls | - Argon2id password hashing (RFC 9106)<br>- Secure `HttpOnly`, `SameSite=Lax`, `Secure` cookies<br>- Cryptographically signed JWT tokens with short lifetimes<br>- IP & User-Agent binding for sensitive sessions<br>- Rate limiting on `/api/auth/login` (5 attempts / 15 mins) |
| **Tampering** | Silent alteration of historical medication dosages or recommendation versions | - Immutable history tables (`_versions`) with append-only access pattern<br>- Foreign key constraints linking versions to audit logs<br>- Soft deletion for critical records; historical rows are never updated or dropped<br>- Strict JSON Schema validation with Zod on all API inputs |
| **Repudiation** | Denying an unauthorized medication change or data wipe | - Dedicated `audit_logs` table capturing timestamp, action, entity, user_id, client IP, and metadata<br>- Audit logs cannot be modified via user interface<br>- Medical content and credentials excluded from log payloads |
| **Information Disclosure** | Data leakage through stack traces, unauthorized API access, insecure backups | - Generic error responses; internal exceptions never returned to client<br>- Zero unauthenticated API routes (except `/api/auth/login` and `/api/health`)<br>- Database credentials stored strictly in `.env`, excluded from git repository<br>- CSP headers preventing exfiltration of rendered medical notes |
| **Denial of Service** | Resource exhaustion via file upload or rapid chat message submissions | - Request body payload caps (10MB for file uploads, 64KB for JSON)<br>- Memory-bounded in-memory / redis-ready rate limiter<br>- Strict database connection pooling via Prisma |
| **Elevation of Privilege** | Unauthenticated user accessing admin or clinical modification endpoints | - Single-user hardened model with explicit authentication middleware<br>- No default bypass routes<br>- API keys for agents restricted to append-only versioning actions |

---

## 3. OWASP Top 10 Safeguards

### 1. Broken Access Control
- All API routes under `/api/*` (except login and health) pass through a central session verification guard.
- Every read/write query filters by `userId` to prevent IDOR vulnerabilities.

### 2. Cryptographic Failures
- Passwords hashed using **Argon2id** (memory cost 65536 KB, iterations 3, parallelism 4).
- Session tokens use `HMAC-SHA256` or `Ed25519` signed JWTs with expiration.
- Database passwords and application secrets managed via environment variables.

### 3. Injection (SQL, XSS, Command Injection)
- **SQL Injection**: Prevented using Prisma ORM with parameterized queries.
- **XSS**: Message markdown rendering is sanitized using DOMPurify / strict markdown component mappings, stripping raw `<script>`, `<iframe>`, `javascript:` URIs, and dangerous attributes.
- **Command Injection**: Zero shell executions or child processes triggered from user input.

### 4. Insecure Design (Clinical Safety UX)
- **Quarantine of AI Suggestions**: AI responses are tagged with a distinct visual amber badge: `⚠️ AI-generated suggestion — not medical prescription`.
- Prohibits clinical terminology like "Prescribed" or "Doctor Approved" unless explicitly assigned by the human operator.
- Dosage modifications require confirmation and explicit reason recording.

### 5. Security Misconfiguration
- Hardened HTTP Response Headers enabled on all responses:
  - `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none';`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### 6. Vulnerable and Outdated Components
- Minimal direct dependencies.
- Routine security vulnerability audits with `npm audit` / `pnpm audit`.

### 7. Identification and Authentication Failures
- Login rate-limiting with exponential backoff on repeated failures.
- Brute-force protection: 5 failed attempts locks login for 15 minutes.
- Audit log records `LOGIN_FAILED` with originating IP.

### 8. Software and Data Integrity Failures
- File uploads validate MIME type and magic bytes (JPEG, PNG, PDF only).
- Uploaded files are renamed to UUIDs and stored outside public web roots.

### 9. Security Logging and Monitoring Failures
- Structured audit logs record:
  - `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`, `PASSWORD_CHANGED`
  - `CONVERSATION_CREATED`, `MESSAGE_CREATED`, `MESSAGE_UPDATED`
  - `RECOMMENDATION_CREATED`, `RECOMMENDATION_VERSION_CREATED`
  - `MEDICATION_CREATED`, `MEDICATION_VERSION_CREATED`
  - `DIET_CREATED`, `DIET_VERSION_CREATED`
  - `FILE_UPLOADED`, `FILE_DELETED`
- Sensitive fields (passwords, tokens, cookies, full medical notes) are explicitly excluded from logs.

### 10. Server-Side Request Forgery (SSRF)
- The application makes no outbound HTTP requests based on user-supplied URLs.
