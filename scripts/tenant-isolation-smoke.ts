/**
 * Multi-user isolation smoke test against a running HealthVault instance.
 *
 * User B creates a conversation, a recommendation and a medication. User A then tries to
 * reference / read them through every REST route that accepts a related id. Every cross-tenant
 * attempt must be rejected (404) and create nothing. Also checks the recommendation status
 * policy. All records created by the script are deleted at the end.
 *
 * Usage:
 *   BASE_URL=https://healthai.nclabs.dev \
 *   USER_A=... PASS_A=... USER_B=... PASS_B=... \
 *   pnpm tsx scripts/tenant-isolation-smoke.ts
 */

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const TAG = `[isolation-smoke ${new Date().toISOString()}]`;

type Session = { name: string; cookie: string };
type Result = { name: string; ok: boolean; detail: string };

const results: Result[] = [];
const cleanup: Array<() => Promise<unknown>> = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

async function login(name: string, username: string, password: string): Promise<Session> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Login ${name} failed: HTTP ${res.status}`);
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/healthvault_session=[^;]+/);
  if (!match) throw new Error(`Login ${name}: session cookie not returned`);
  return { name, cookie: match[0] };
}

async function call(s: Session, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Cookie: s.cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
}

/** Cross-tenant write must be rejected; if it was accepted, register the row for cleanup. */
async function expectRejected(name: string, s: Session, path: string, body: unknown, deletePath: (json: any) => string | null) {
  const r = await call(s, "POST", path, body);
  const ok = r.status === 404 && r.json?.code === "FOREIGN_KEY_NOT_OWNED";
  if (r.status >= 200 && r.status < 300) {
    const del = deletePath(r.json);
    if (del) cleanup.push(() => call(s, "DELETE", del));
  }
  check(name, ok, `HTTP ${r.status}${r.json?.code ? ` ${r.json.code}` : ""}`);
}

async function main() {
  console.log(`Target: ${BASE_URL}\n`);
  const a = await login("A", env("USER_A"), env("PASS_A"));
  const b = await login("B", env("USER_B"), env("PASS_B"));

  // --- User B fixtures
  const convB = await call(b, "POST", "/api/conversations", { title: `${TAG} B` });
  if (convB.status !== 201) throw new Error(`B conversation: HTTP ${convB.status}`);
  const convBId = convB.json.conversation.id;
  cleanup.push(() => call(b, "DELETE", `/api/conversations/${convBId}`));

  const recB = await call(b, "POST", "/api/recommendations", { title: `${TAG} B protocolo`, conversationId: convBId });
  if (recB.status !== 201) throw new Error(`B recommendation: HTTP ${recB.status}`);
  const recBId = recB.json.recommendation.id;
  cleanup.push(() => call(b, "DELETE", `/api/recommendations/${recBId}`));

  const medB = await call(b, "POST", "/api/medications", {
    name: `${TAG} B med`,
    doseValue: 1,
    doseUnit: "mg",
    frequency: "semanal",
    recommendationId: recBId,
  });
  if (medB.status !== 201) throw new Error(`B medication: HTTP ${medB.status}`);
  const medBId = medB.json.medication.id;
  cleanup.push(() => call(b, "DELETE", `/api/medications/${medBId}`));

  // --- User A own fixtures (positive controls)
  const convA = await call(a, "POST", "/api/conversations", { title: `${TAG} A` });
  const convAId = convA.json.conversation.id;
  cleanup.push(() => call(a, "DELETE", `/api/conversations/${convAId}`));

  const recA = await call(a, "POST", "/api/recommendations", { title: `${TAG} A protocolo`, conversationId: convAId });
  check("control: A creates recommendation in own conversation", recA.status === 201, `HTTP ${recA.status}`);
  const recAId = recA.json?.recommendation?.id;
  if (recAId) cleanup.push(() => call(a, "DELETE", `/api/recommendations/${recAId}`));

  // --- 1. Cross-tenant writes
  await expectRejected("A → recommendation in B's conversation", a, "/api/recommendations",
    { title: `${TAG} injected`, conversationId: convBId }, (j) => j?.recommendation?.id && `/api/recommendations/${j.recommendation.id}`);
  await expectRejected("A → medication linked to B's recommendation", a, "/api/medications",
    { name: `${TAG} injected`, doseValue: 1, doseUnit: "mg", frequency: "diária", recommendationId: recBId },
    (j) => j?.medication?.id && `/api/medications/${j.medication.id}`);
  await expectRejected("A → medication in B's conversation", a, "/api/medications",
    { name: `${TAG} injected`, doseValue: 1, doseUnit: "mg", frequency: "diária", conversationId: convBId },
    (j) => j?.medication?.id && `/api/medications/${j.medication.id}`);
  await expectRejected("A → symptom linked to B's medication", a, "/api/health/symptoms",
    { symptom: `${TAG} injected`, severity: 1, medicationId: medBId }, (j) => j?.symptom?.id && `/api/health/symptoms/${j.symptom.id}`);
  await expectRejected("A → symptom in B's conversation", a, "/api/health/symptoms",
    { symptom: `${TAG} injected`, severity: 1, conversationId: convBId }, (j) => j?.symptom?.id && `/api/health/symptoms/${j.symptom.id}`);
  await expectRejected("A → body metric in B's conversation", a, "/api/health/metrics",
    { weightKg: 1, notes: TAG, conversationId: convBId }, (j) => j?.metric?.id && `/api/health/metrics/${j.metric.id}`);
  await expectRejected("A → lab in B's conversation", a, "/api/health/labs",
    { testName: `${TAG} injected`, category: "smoke", testDate: new Date().toISOString(), markerName: "x", resultValue: 1, unit: "x", conversationId: convBId }, (j) => j?.lab?.id && `/api/health/labs/${j.lab.id}`);
  await expectRejected("A → diet in B's conversation", a, "/api/diets",
    { title: `${TAG} injected`, targetCalories: 1, targetProteinG: 1, targetCarbsG: 1, targetFatG: 1, conversationId: convBId },
    (j) => j?.dietPlan?.id && `/api/diets/${j.dietPlan.id}`);

  if (recAId) {
    const put = await call(a, "PUT", `/api/recommendations/${recAId}`, { changeReason: TAG, conversationId: convBId });
    check("A → move own recommendation into B's conversation", put.status === 404, `HTTP ${put.status}`);
  }

  // --- 2. Cross-tenant reads
  const readConv = await call(a, "GET", `/api/conversations/${convBId}`);
  check("A cannot read B's conversation", readConv.status === 404, `HTTP ${readConv.status}`);
  const readRec = await call(a, "GET", `/api/recommendations/${recBId}`);
  check("A cannot read B's recommendation", readRec.status === 404, `HTTP ${readRec.status}`);
  const readRecs = await call(a, "GET", `/api/recommendations?conversationId=${convBId}`);
  check("A's recommendation list filtered by B's conversation is empty",
    readRecs.status === 200 && (readRecs.json?.recommendations || []).length === 0, `${(readRecs.json?.recommendations || []).length} rows`);
  const bView = await call(b, "GET", `/api/conversations/${convBId}`);
  const foreignInB = (bView.json?.conversation?.recommendations || []).filter((r: any) => r.title?.includes("injected"));
  check("B's conversation shows no records injected by A", foreignInB.length === 0, `${foreignInB.length} injected`);

  // --- 3. Status policy
  if (recAId) {
    for (const status of ["DOCTOR_RECOMMENDATION", "CONFIRMED"]) {
      const r = await call(a, "PUT", `/api/recommendations/${recAId}`, { status, changeReason: TAG });
      check(`manual PUT status ${status} rejected`, r.status === 403, `HTTP ${r.status}${r.json?.code ? ` ${r.json.code}` : ""}`);
    }
    const archived = await call(a, "PUT", `/api/recommendations/${recAId}`, { status: "ARCHIVED", changeReason: TAG });
    check("manual PUT status ARCHIVED allowed", archived.status === 200, `HTTP ${archived.status}`);
  }
  const postDoctor = await call(a, "POST", "/api/recommendations", { title: `${TAG} doctor`, status: "DOCTOR_RECOMMENDATION" });
  if (postDoctor.status === 201) cleanup.push(() => call(a, "DELETE", `/api/recommendations/${postDoctor.json.recommendation.id}`));
  check("manual POST status DOCTOR_RECOMMENDATION rejected", postDoctor.status === 400, `HTTP ${postDoctor.status}`);

  // --- 4. Client-supplied provenance ignored
  const medA = await call(a, "POST", "/api/medications", {
    name: `${TAG} A med`, doseValue: 1, doseUnit: "mg", frequency: "diária", actorType: "DOCTOR", actorName: "Dr. Fake",
  });
  if (medA.status === 201) {
    const medAId = medA.json.medication.id;
    cleanup.push(() => call(a, "DELETE", `/api/medications/${medAId}`));
    const versions = await call(a, "GET", `/api/medications/${medAId}/versions`);
    const v = versions.json?.versions?.[0];
    check("medication actorType/actorName from client ignored", v?.actorType === "USER" && v?.actorName !== "Dr. Fake",
      `actorType=${v?.actorType} actorName=${v?.actorName}`);
  } else {
    check("medication actorType/actorName from client ignored", false, `create HTTP ${medA.status}`);
  }
}

main()
  .catch((e) => {
    check("script", false, e.message);
  })
  .finally(async () => {
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch {}
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed. Test records cleaned up.`);
    process.exit(failed.length ? 1 : 0);
  });
