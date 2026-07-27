import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildWebsitePlan } from "../packages/ai-brain/src/index";
import { buildProjectFiles } from "../packages/template-engine/src/index";
import { ensureFullStackArtifacts } from "../apps/api/src/fullstack-fallback";
import { validateGeneratedProject } from "../apps/api/src/project-validator";
import {
  GENERATION_STALE_AFTER_MS,
  generationJobIsStale,
} from "../apps/api/src/index";
import {
  loadAppearance,
  saveAppearance,
  type AppearanceSettings,
} from "../apps/mobile/src/appearance";
import { registerLiveSiteReadRoutes } from "../apps/api/src/live-sites-routes";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

async function fallbackPlan(prompt: string) {
  return (await buildWebsitePlan(prompt, {})).plan;
}

async function generatorRequirements() {
  const portfolioPlan = await fallbackPlan(
    "Create a personal portfolio for Maya Rao with selected work, detailed case studies, an about screen and contact."
  );
  assert.equal(portfolioPlan.appSpec.projectKind, "portfolio");
  const portfolio = buildProjectFiles(portfolioPlan);
  assert.match(portfolio.previewHtml, /Selected work|Featured projects/i);
  assert.doesNotMatch(portfolio.previewHtml, /SaaS dashboard|pricing plans/i);

  const calculatorPlan = await fallbackPlan(
    "Create a calculator. Table columns: Principal, Annual Rate, Years, Monthly Payment. " +
      "Fields: Principal, Annual Rate, Years. Formula Monthly Payment = Principal * Annual Rate / 12. " +
      "The formula must update when inputs change and allow saving calculations."
  );
  assert.equal(calculatorPlan.appSpec.projectKind, "calculator");
  assert.deepEqual(
    calculatorPlan.appSpec.entities[0].fields.map((field) => field.label),
    ["Principal", "Annual Rate", "Years", "Monthly Payment"]
  );
  assert.equal(
    calculatorPlan.appSpec.calculations[0].expression,
    "principal * annual_rate / 12"
  );
  assert.deepEqual(calculatorPlan.appSpec.calculations[0].inputFields, [
    "principal",
    "annual_rate",
  ]);
  assert.equal(
    calculatorPlan.appSpec.calculations[0].outputField,
    "monthly_payment"
  );
  const calculator = buildProjectFiles(calculatorPlan);
  const previewScripts = [
    ...calculator.previewHtml.matchAll(/<script>([\s\S]*?)<\/script>/g),
  ].map((match) => match[1]);
  assert.ok(previewScripts.length > 0);
  for (const script of previewScripts) {
    assert.doesNotThrow(() => new Function(script));
  }
  assert.match(calculator.previewHtml, /data-calculation=/);
  const calculatorValidation = validateGeneratedProject(
    calculator.files,
    calculatorPlan.appSpec.summary,
    calculatorPlan.appSpec
  );
  assert.equal(
    calculatorValidation.passed,
    true,
    calculatorValidation.errors.join("\n")
  );

  const adminPlan = await fallbackPlan(
    "Create an admin panel to manage users. Columns: Name, Email, Role, Status. " +
      "Add, edit, delete, search, sort and export CSV. Do not include pricing or testimonials."
  );
  assert.equal(adminPlan.appSpec.projectKind, "admin_panel");
  const admin = buildProjectFiles(adminPlan);
  const adminApp =
    admin.files.find((file) => file.path === "src/App.jsx")?.content || "";
  const adminVisiblePreview = admin.previewHtml.replace(
    /<head>[\s\S]*?<\/head>/i,
    ""
  );
  assert.doesNotMatch(adminVisiblePreview, /pricing|testimonial/i);
  assert.doesNotMatch(adminApp, /pricing|testimonial/i);
  assert.match(adminApp, /createRecord/);
  assert.match(adminApp, /deleteRecord/);

  const ecommercePlan = await fallbackPlan(
    "Create an ecommerce application with a searchable product catalogue, working cart and checkout."
  );
  assert.equal(ecommercePlan.appSpec.projectKind, "ecommerce_application");
  assert.deepEqual(
    ecommercePlan.appSpec.entities.map((entity) => entity.key),
    ["products", "orders"]
  );
  const ecommerce = buildProjectFiles(ecommercePlan);
  const ecommerceApp =
    ecommerce.files.find((file) => file.path === "src/App.jsx")?.content || "";
  assert.match(ecommerceApp, /addToCart/);
  assert.match(ecommerceApp, /async function checkout/);
  assert.equal(
    validateGeneratedProject(
      ecommerce.files,
      ecommercePlan.appSpec.summary,
      ecommercePlan.appSpec
    ).passed,
    true
  );

  const palettePlan = await fallbackPlan(
    "Create a customer dashboard. Binding website palette (Gold): primary #d97706, secondary #f59e0b, background #fffbeb, text #451a03"
  );
  assert.deepEqual(palettePlan.theme, {
    style: "Gold palette",
    primary: "#d97706",
    secondary: "#f59e0b",
    background: "#fffbeb",
    text: "#451a03",
  });

  const uploadPlan = await fallbackPlan(
    "Create a CRUD application for listings with fields: Name, Photo Upload, Status. Users must upload a photo."
  );
  const uploadProject = buildProjectFiles(uploadPlan);
  const uploadValidation = validateGeneratedProject(
    uploadProject.files,
    uploadPlan.appSpec.summary,
    uploadPlan.appSpec
  );
  assert.equal(uploadValidation.passed, false);
  assert.ok(
    uploadValidation.errors.some((message) =>
      /upload\/storage behavior is missing/i.test(message)
    ),
    uploadValidation.errors.join("\n")
  );

  const deliberatelyIncomplete = calculator.files.map((file) =>
    file.path === "src/App.jsx"
      ? {
          ...file,
          content: `import './styles.css'; export default function App(){return <main><h1>Calculator</h1><form onSubmit={() => undefined}><input /></form><table><thead><tr><th>Principal</th></tr></thead></table></main>}`,
        }
      : file
  );
  const rejected = validateGeneratedProject(
    deliberatelyIncomplete,
    calculatorPlan.appSpec.summary,
    calculatorPlan.appSpec
  );
  assert.equal(rejected.passed, false);
  assert.ok(
    rejected.errors.some((message) => /table column is missing/i.test(message)),
    rejected.errors.join("\n")
  );

  const oldGeneric = [
    {
      path: "src/App.jsx",
      content:
        "export default function App(){return <><h1>Generic SaaS</h1><section>Pricing</section></>}",
    },
  ];
  const afterCoderFailure = ensureFullStackArtifacts(
    calculatorPlan.appSpec.summary,
    oldGeneric
  );
  assert.deepEqual(afterCoderFailure, oldGeneric);
  assert.equal(
    validateGeneratedProject(
      afterCoderFailure,
      calculatorPlan.appSpec.summary,
      calculatorPlan.appSpec
    ).passed,
    false
  );
}

function lifecycleWatchdog() {
  const now = Date.now();
  assert.equal(
    generationJobIsStale(
      "running",
      new Date(now - GENERATION_STALE_AFTER_MS - 1).toISOString(),
      now
    ),
    true
  );
  assert.equal(
    generationJobIsStale(
      "queued",
      new Date(now - GENERATION_STALE_AFTER_MS - 1).toISOString(),
      now
    ),
    true
  );
  for (const status of ["completed", "failed", "cancelled"]) {
    assert.equal(
      generationJobIsStale(
        status,
        new Date(now - GENERATION_STALE_AFTER_MS * 2).toISOString(),
        now
      ),
      false
    );
  }
  const worker = source("apps/api/src/index.ts");
  assert.match(worker, /failStaleGenerationJobs/);
  assert.match(worker, /refundNexoraTokens/);
  assert.match(
    worker,
    /\.in\(['"]status['"], \[['"]queued['"], ['"]running['"]\]\)/
  );
}

type QueryResult = { data: any; error: null };

class FakeQuery implements PromiseLike<QueryResult> {
  filters: Array<[string, unknown]> = [];
  constructor(private table: string, private records: Record<string, any[]>) {}
  select() {
    return this;
  }
  eq(field: string, value: unknown) {
    this.filters.push([field, value]);
    return this;
  }
  neq() {
    return this;
  }
  in() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    const value = this.filtered()[0] || null;
    return Promise.resolve({ data: value, error: null });
  }
  private filtered() {
    return (this.records[this.table] || []).filter((row) =>
      this.filters.every(([field, value]) => row[field] === value)
    );
  }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.filtered(), error: null }).then(
      onfulfilled,
      onrejected
    );
  }
}

async function ownerScoping() {
  const handlers = new Map<string, (context: any) => Promise<any>>();
  const records = {
    published_sites: [
      {
        id: "site-a",
        owner_email: "a@example.com",
        project_id: "project-a",
        status: "live",
      },
      {
        id: "site-b",
        owner_email: "b@example.com",
        project_id: "project-b",
        status: "live",
      },
    ],
    site_deployments: [
      { id: "deployment-a", owner_email: "a@example.com", site_id: "site-a" },
      { id: "deployment-b", owner_email: "b@example.com", site_id: "site-b" },
    ],
    deployment_events: [],
  };
  registerLiveSiteReadRoutes(
    {
      get: (path: string, handler: (context: any) => Promise<any>) => {
        handlers.set(path, handler);
      },
    },
    {
      authenticatedEmail: async () => "a@example.com",
      requireSupabase: () =>
        ({
          from: (table: string) => new FakeQuery(table, records),
        } as any),
    }
  );
  const json = (body: any, status = 200) => ({ body, status });
  const list = await handlers.get("/live-sites")!({
    req: { param: () => "" },
    json,
  });
  assert.deepEqual(
    list.body.sites.map((site: any) => site.id),
    ["site-a"]
  );

  const forbidden = await handlers.get("/live-sites/:id/deployments")!({
    req: { param: () => "site-b" },
    json,
  });
  assert.equal(forbidden.status, 404);
}

function appearancePersistence() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const expected: AppearanceSettings = {
    appearanceMode: "dark",
    accentPreset: "emerald",
    customAccent: null,
  };
  saveAppearance(expected, storage);
  assert.deepEqual(loadAppearance(storage), expected);
}

function securityAndPublishGate() {
  const worker = source("apps/api/src/index.ts");
  const liveRoutes = source("apps/api/src/live-sites-routes.ts");
  const mobile = source("apps/mobile/src/App.tsx");
  const firebaseStatusStart = worker.indexOf(
    "app.get('/integrations/firebase/status'"
  );
  const firebaseStatusEnd = worker.indexOf(
    "app.get('/integrations/firebase/start'"
  );
  const firebaseStatus = worker.slice(firebaseStatusStart, firebaseStatusEnd);
  assert.doesNotMatch(
    firebaseStatus,
    /encrypted_access_token|encrypted_refresh_token/
  );
  assert.doesNotMatch(firebaseStatus, /accessToken|refreshToken/);
  assert.match(worker, /encryptSecret\(env, input\.accessToken\)/);
  assert.match(
    worker,
    /consumeOauthState\(supabase, state, ['"]firebase['"]\)/
  );
  assert.match(worker, /origin: \(origin, c\)/);
  assert.doesNotMatch(worker, /cors\(\{\s*origin:\s*['"]\*['"]/);
  assert.match(liveRoutes, /\.eq\(['"]owner_email['"], email\)/);
  assert.match(
    worker,
    /Publish remains disabled until the required backend passes a real read\/write verification/
  );
  assert.match(mobile, /!backendVerified/);
  const firebaseProvider = source("apps/api/src/firebase-provider.ts");
  assert.match(firebaseProvider, /deployStorageRules/);
  assert.match(firebaseProvider, /verifyStorageReadWrite/);
  assert.match(firebaseProvider, /request\.auth\.uid == userId/);
}

async function main() {
  await generatorRequirements();
  lifecycleWatchdog();
  await ownerScoping();
  appearancePersistence();
  securityAndPublishGate();
  console.log(
    "Nexora production regression tests passed (14 requirement groups)."
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
