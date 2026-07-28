import type { BackendProvisioningPlan } from "./backend-planning";

type FirebaseProject = {
  projectId: string;
  displayName: string;
  state: string;
  resources?: Record<string, unknown>;
};

export type ProviderOperation = {
  type: string;
  resourceType: string;
  resourceName: string;
  status: "completed" | "failed" | "skipped";
  result?: Record<string, unknown>;
  error?: string;
};

export type FirebaseProvisioningResult = {
  externalProjectId: string;
  databaseId: string;
  safePublicConfig: Record<string, string>;
  operations: ProviderOperation[];
  verification: {
    passed: boolean;
    documentPath: string;
    storageObjectPath?: string;
  };
};

class FirebaseProviderError extends Error {
  readonly operations: ProviderOperation[];

  constructor(message: string, operations: ProviderOperation[]) {
    super(message);
    this.name = "FirebaseProviderError";
    this.operations = operations;
  }
}

async function providerFetch(
  url: string,
  accessToken: string,
  init: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `Firebase provider request timed out after ${timeoutMs}ms.`
      );
    }
    throw new Error(
      error instanceof Error
        ? `Firebase provider network error: ${error.message}`
        : "Firebase provider network error."
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function clientFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `Firebase client verification timed out after ${timeoutMs}ms.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function providerJson(
  url: string,
  accessToken: string,
  init: RequestInit = {},
  accepted: number[] = [200]
): Promise<Record<string, any>> {
  const response = await providerFetch(url, accessToken, init);
  const data = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!accepted.includes(response.status)) {
    const message =
      typeof data.error?.message === "string"
        ? data.error.message
        : `HTTP ${response.status}`;
    throw new Error(`Firebase provider rejected the request: ${message}`);
  }
  return data;
}

async function waitForOperation(
  baseUrl: string,
  operationName: string,
  accessToken: string
): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const operation = await providerJson(
      `${baseUrl}/${operationName.replace(/^\/+/, "")}`,
      accessToken
    );
    if (operation.done === true) {
      if (operation.error) {
        throw new Error(
          `Firebase operation failed: ${
            operation.error.message || operation.error.code || "unknown error"
          }`
        );
      }
      return operation.response || operation;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Firebase operation did not finish within 20 seconds.");
}

export async function listFirebaseProjects(
  accessToken: string
): Promise<FirebaseProject[]> {
  const data = await providerJson(
    "https://firebase.googleapis.com/v1beta1/projects?pageSize=100",
    accessToken
  );
  return (Array.isArray(data.results) ? data.results : [])
    .map((project: Record<string, any>) => ({
      projectId: String(project.projectId || ""),
      displayName: String(project.displayName || project.projectId || ""),
      state: String(project.state || "UNKNOWN"),
      resources: project.resources || {},
    }))
    .filter((project: FirebaseProject) => project.projectId);
}

async function createGoogleProject(
  projectId: string,
  displayName: string,
  accessToken: string
): Promise<void> {
  const operation = await providerJson(
    "https://cloudresourcemanager.googleapis.com/v3/projects",
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        projectId,
        displayName,
      }),
    },
    [200, 201]
  );
  if (operation.name) {
    await waitForOperation(
      "https://cloudresourcemanager.googleapis.com/v3",
      operation.name,
      accessToken
    );
  }
}

async function addFirebase(
  projectId: string,
  accessToken: string
): Promise<void> {
  const operation = await providerJson(
    `https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(
      projectId
    )}:addFirebase`,
    accessToken,
    { method: "POST", body: "{}" },
    [200]
  );
  if (operation.name) {
    await waitForOperation(
      "https://firebase.googleapis.com/v1beta1",
      operation.name,
      accessToken
    );
  }
}

async function ensureDatabase(
  projectId: string,
  databaseId: string,
  region: string,
  accessToken: string
): Promise<void> {
  const response = await providerFetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/databases?databaseId=${encodeURIComponent(databaseId)}`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        type: "FIRESTORE_NATIVE",
        locationId: region,
      }),
    },
    45000
  );
  if (![200, 201, 409].includes(response.status)) {
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      any
    >;
    throw new Error(
      `Firestore database creation failed: ${
        data.error?.message || `HTTP ${response.status}`
      }`
    );
  }
  if (response.status === 409) {
    const existing = await providerJson(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        projectId
      )}/databases/${encodeURIComponent(databaseId)}`,
      accessToken
    );
    const actualRegion = String(existing.locationId || "");
    if (actualRegion && actualRegion !== region) {
      throw new Error(
        `Firestore database ${databaseId} already exists in ${actualRegion}, not the reviewed region ${region}. Choose ${actualRegion} or another isolated database.`
      );
    }
  }
}

async function deployRules(
  projectId: string,
  databaseId: string,
  rules: string,
  accessToken: string
): Promise<void> {
  const ruleset = await providerJson(
    `https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/rulesets`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        source: {
          files: [
            {
              name: "firestore.rules",
              content: rules,
            },
          ],
        },
      }),
    },
    [200]
  );
  if (!ruleset.name)
    throw new Error("Firebase Rules did not return a ruleset name.");
  const releaseName =
    databaseId === "(default)"
      ? `projects/${projectId}/releases/cloud.firestore`
      : `projects/${projectId}/releases/cloud.firestore/${databaseId}`;
  await providerJson(
    `https://firebaserules.googleapis.com/v1/${releaseName}`,
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: releaseName,
        rulesetName: ruleset.name,
      }),
    },
    [200]
  );
}

async function deployStorageRules(
  projectId: string,
  bucketName: string,
  accessToken: string
): Promise<void> {
  const rules = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}`;
  const ruleset = await providerJson(
    `https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/rulesets`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        source: {
          files: [
            {
              name: "storage.rules",
              content: rules,
            },
          ],
        },
      }),
    },
    [200]
  );
  if (!ruleset.name)
    throw new Error("Firebase Storage Rules did not return a ruleset name.");
  const releaseName = `projects/${projectId}/releases/firebase.storage/${bucketName}`;
  await providerJson(
    `https://firebaserules.googleapis.com/v1/${releaseName}`,
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: releaseName,
        rulesetName: ruleset.name,
      }),
    },
    [200]
  );
}

async function createIndexes(
  projectId: string,
  databaseId: string,
  plan: BackendProvisioningPlan,
  accessToken: string
): Promise<void> {
  for (const index of plan.indexes) {
    const response = await providerFetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        projectId
      )}/databases/${encodeURIComponent(
        databaseId
      )}/collectionGroups/${encodeURIComponent(index.collection)}/indexes`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          queryScope: "COLLECTION",
          fields: index.fields.map((field) => ({
            fieldPath: field.field,
            order: field.order,
          })),
        }),
      }
    );
    if (![200, 201, 409].includes(response.status)) {
      const data = (await response.json().catch(() => ({}))) as Record<
        string,
        any
      >;
      throw new Error(
        `Firestore index creation failed for ${index.collection}: ${
          data.error?.message || `HTTP ${response.status}`
        }`
      );
    }
  }
}

async function configureAuthentication(
  projectId: string,
  providers: string[],
  accessToken: string
): Promise<void> {
  const emailPassword = providers.some((provider) =>
    /email|password/.test(provider)
  );
  const unsupported = providers.filter(
    (provider) => !/anonymous|email|password/.test(provider)
  );
  if (unsupported.length) {
    throw new Error(
      `Firebase authentication provider configuration is not automated for: ${unsupported.join(
        ", "
      )}. Configure its provider credentials before confirming this plan.`
    );
  }
  const updateMask = [
    "signIn.anonymous.enabled",
    ...(emailPassword
      ? ["signIn.email.enabled", "signIn.email.passwordRequired"]
      : []),
  ].join(",");
  await providerJson(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(
      projectId
    )}/config?updateMask=${encodeURIComponent(updateMask)}`,
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify({
        signIn: {
          anonymous: { enabled: true },
          ...(emailPassword
            ? {
                email: {
                  enabled: true,
                  passwordRequired: true,
                },
              }
            : {}),
        },
      }),
    },
    [200]
  );
}

async function ensureStorageBucket(
  projectId: string,
  region: string,
  accessToken: string
): Promise<void> {
  const response = await providerFetch(
    `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(
      projectId
    )}`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        name: `${projectId}.appspot.com`,
        location: region,
      }),
    }
  );
  if (![200, 201, 409].includes(response.status)) {
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      any
    >;
    throw new Error(
      `Cloud Storage bucket creation failed: ${
        data.error?.message || `HTTP ${response.status}`
      }`
    );
  }
}

async function ensureWebApp(
  projectId: string,
  displayName: string,
  accessToken: string
): Promise<Record<string, string>> {
  const list = await providerJson(
    `https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(
      projectId
    )}/webApps?pageSize=100`,
    accessToken
  );
  let app = Array.isArray(list.apps) ? list.apps[0] : null;
  if (!app) {
    const operation = await providerJson(
      `https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(
        projectId
      )}/webApps`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({ displayName }),
      },
      [200]
    );
    app = operation.name
      ? await waitForOperation(
          "https://firebase.googleapis.com/v1beta1",
          operation.name,
          accessToken
        )
      : operation.response;
  }
  const appName = String(app?.name || "");
  if (!appName) throw new Error("Firebase web app was not created.");
  const config = await providerJson(
    `https://firebase.googleapis.com/v1beta1/${appName.replace(
      /^\/+/,
      ""
    )}/config`,
    accessToken
  );
  return {
    VITE_FIREBASE_API_KEY: String(config.apiKey || ""),
    VITE_FIREBASE_AUTH_DOMAIN: String(config.authDomain || ""),
    VITE_FIREBASE_PROJECT_ID: String(config.projectId || projectId),
    VITE_FIREBASE_STORAGE_BUCKET: String(config.storageBucket || ""),
    VITE_FIREBASE_APP_ID: String(config.appId || app?.appId || ""),
    VITE_FIREBASE_MESSAGING_SENDER_ID: String(config.messagingSenderId || ""),
  };
}

function firestoreValue(value: unknown): Record<string, unknown> {
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number")
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  return { stringValue: String(value ?? "") };
}

async function createAnonymousIdentity(
  apiKey: string
): Promise<{ idToken: string; localId: string }> {
  const signUp = await clientFetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(
      apiKey
    )}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    }
  );
  const identity = (await signUp.json().catch(() => ({}))) as Record<
    string,
    any
  >;
  if (!signUp.ok || !identity.idToken || !identity.localId) {
    throw new Error(
      `Firebase client identity verification failed: ${
        identity.error?.message || `HTTP ${signUp.status}`
      }`
    );
  }
  return {
    idToken: String(identity.idToken),
    localId: String(identity.localId),
  };
}

async function verifyClientReadWrite(
  projectId: string,
  databaseId: string,
  collectionName: string,
  config: Record<string, string>
): Promise<string> {
  const identity = await createAnonymousIdentity(config.VITE_FIREBASE_API_KEY);
  const documentId = `nexora-${crypto.randomUUID()}`;
  const path = `projects/${projectId}/databases/${databaseId}/documents/${collectionName}/${documentId}`;
  const url = `https://firestore.googleapis.com/v1/${path}`;
  const headers = {
    Authorization: `Bearer ${identity.idToken}`,
    "content-type": "application/json",
  };
  const write = await clientFetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      fields: {
        ownerId: firestoreValue(identity.localId),
        verification: firestoreValue(true),
      },
    }),
  });
  if (!write.ok) {
    const data = (await write.json().catch(() => ({}))) as Record<string, any>;
    throw new Error(
      `Firebase verification write failed: ${
        data.error?.message || `HTTP ${write.status}`
      }`
    );
  }
  const read = await clientFetch(url, { headers });
  if (!read.ok) {
    throw new Error(`Firebase verification read failed (HTTP ${read.status}).`);
  }
  const remove = await clientFetch(url, { method: "DELETE", headers });
  if (!remove.ok) {
    throw new Error(
      `Firebase verification cleanup failed (HTTP ${remove.status}).`
    );
  }
  return path;
}

async function verifyStorageReadWrite(
  bucketName: string,
  config: Record<string, string>
): Promise<string> {
  const identity = await createAnonymousIdentity(config.VITE_FIREBASE_API_KEY);
  const objectPath = `users/${
    identity.localId
  }/nexora-verification-${crypto.randomUUID()}.txt`;
  const objectUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
    bucketName
  )}/o/${encodeURIComponent(objectPath)}`;
  const headers = { Authorization: `Bearer ${identity.idToken}` };
  const upload = await clientFetch(
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
      bucketName
    )}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`,
    {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "text/plain",
      },
      body: "nexora-storage-verification",
    }
  );
  if (!upload.ok) {
    const data = (await upload.json().catch(() => ({}))) as Record<string, any>;
    throw new Error(
      `Firebase Storage verification upload failed: ${
        data.error?.message || `HTTP ${upload.status}`
      }`
    );
  }
  const read = await clientFetch(objectUrl, { headers });
  if (!read.ok) {
    throw new Error(
      `Firebase Storage verification read failed (HTTP ${read.status}).`
    );
  }
  const remove = await clientFetch(objectUrl, { method: "DELETE", headers });
  if (!remove.ok) {
    throw new Error(
      `Firebase Storage verification cleanup failed (HTTP ${remove.status}).`
    );
  }
  return objectPath;
}

export async function provisionFirebaseBackend(input: {
  accessToken: string;
  plan: BackendProvisioningPlan;
  websiteName: string;
  namespace: string;
}): Promise<FirebaseProvisioningResult> {
  const { accessToken, plan } = input;
  const operations: ProviderOperation[] = [];
  const projectId = plan.createProject?.projectId || plan.externalProjectId;
  if (!projectId) {
    throw new FirebaseProviderError(
      "Select an existing Firebase project or confirm creation of a new one.",
      operations
    );
  }
  const databaseId =
    plan.isolationMode === "named_database"
      ? input.namespace.slice(0, 60)
      : "(default)";
  const run = async (
    type: string,
    resourceType: string,
    resourceName: string,
    operation: () => Promise<void>
  ) => {
    try {
      await operation();
      operations.push({
        type,
        resourceType,
        resourceName,
        status: "completed",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown provider error.";
      operations.push({
        type,
        resourceType,
        resourceName,
        status: "failed",
        error: message,
      });
      throw new FirebaseProviderError(message, operations);
    }
  };

  if (plan.createProject) {
    await run("create", "google_cloud_project", projectId, () =>
      createGoogleProject(
        projectId,
        plan.createProject!.displayName,
        accessToken
      )
    );
    await run("enable", "firebase_project", projectId, () =>
      addFirebase(projectId, accessToken)
    );
  } else {
    await run("verify", "firebase_project", projectId, async () => {
      await providerJson(
        `https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(
          projectId
        )}`,
        accessToken
      );
    });
  }

  await run("create", "firestore_database", databaseId, () =>
    ensureDatabase(projectId, databaseId, plan.region, accessToken)
  );
  await run("configure", "authentication", projectId, () =>
    configureAuthentication(
      projectId,
      plan.authentication.providers,
      accessToken
    )
  );
  await run("deploy", "firestore_rules", databaseId, () =>
    deployRules(projectId, databaseId, plan.securityRules, accessToken)
  );
  if (plan.indexes.length) {
    await run("deploy", "firestore_indexes", databaseId, () =>
      createIndexes(projectId, databaseId, plan, accessToken)
    );
  }
  if (plan.storageBuckets.length) {
    const bucketName = `${projectId}.appspot.com`;
    await run("create", "cloud_storage_bucket", bucketName, () =>
      ensureStorageBucket(projectId, plan.region, accessToken)
    );
    await run("deploy", "storage_rules", bucketName, () =>
      deployStorageRules(projectId, bucketName, accessToken)
    );
  }
  if (plan.functions.length) {
    throw new FirebaseProviderError(
      "Cloud Functions were requested, but the build-artifact deployment pipeline is not configured. No verified-success state was recorded.",
      [
        ...operations,
        {
          type: "deploy",
          resourceType: "cloud_functions",
          resourceName: projectId,
          status: "failed",
          error: "Missing configured build-artifact pipeline.",
        },
      ]
    );
  }

  let safePublicConfig: Record<string, string> = {};
  await run("create", "firebase_web_app", input.namespace, async () => {
    safePublicConfig = await ensureWebApp(
      projectId,
      input.websiteName,
      accessToken
    );
  });
  let verificationPath = "";
  const collection = plan.collections[0]?.name || "nexora_verification";
  await run("verify", "firestore_read_write", collection, async () => {
    verificationPath = await verifyClientReadWrite(
      projectId,
      databaseId,
      collection,
      safePublicConfig
    );
  });
  let storageObjectPath = "";
  if (plan.storageBuckets.length) {
    const bucketName =
      safePublicConfig.VITE_FIREBASE_STORAGE_BUCKET ||
      `${projectId}.appspot.com`;
    await run("verify", "storage_read_write", bucketName, async () => {
      storageObjectPath = await verifyStorageReadWrite(
        bucketName,
        safePublicConfig
      );
    });
  }

  return {
    externalProjectId: projectId,
    databaseId,
    safePublicConfig,
    operations,
    verification: {
      passed: true,
      documentPath: verificationPath,
      ...(storageObjectPath ? { storageObjectPath } : {}),
    },
  };
}

export function firebaseProviderOperations(
  error: unknown
): ProviderOperation[] {
  return error instanceof FirebaseProviderError ? error.operations : [];
}
