import type { ApplicationSpec, AppSpecField } from "@wmai/shared";

export type BackendMode = "none" | "nexora_managed" | "firebase";
export type BackendIsolation =
  | "separate_project"
  | "named_database"
  | "namespaced";

export type BackendSelection = {
  mode: BackendMode;
  region: string;
  isolationMode: BackendIsolation;
  firebaseProjectId?: string;
  createProject?: {
    projectId: string;
    displayName: string;
  };
};

export type BackendProvisioningPlan = {
  version: 1;
  provider: "none" | "nexora-managed" | "firebase";
  required: boolean;
  projectKind: ApplicationSpec["projectKind"];
  region: string;
  isolationMode: BackendIsolation;
  externalProjectId?: string;
  createProject?: {
    projectId: string;
    displayName: string;
  };
  authentication: {
    required: boolean;
    providers: string[];
    anonymousPreviewIdentity: boolean;
  };
  collections: Array<{
    name: string;
    ownerScoped: boolean;
    fields: AppSpecField[];
  }>;
  indexes: Array<{
    collection: string;
    fields: Array<{
      field: string;
      order: "ASCENDING" | "DESCENDING";
    }>;
  }>;
  securityRules: string;
  storageBuckets: string[];
  functions: string[];
  environmentVariables: string[];
  seedData: [];
  externalRequirements: string[];
  verification: {
    write: boolean;
    read: boolean;
    delete: boolean;
    usesClientIdentity: boolean;
  };
};

function safeResourceName(value: string, fallback: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || fallback
  );
}

function firebaseRules(
  collections: BackendProvisioningPlan["collections"]
): string {
  const rules = collections
    .map(
      (collection) => `    match /${safeResourceName(
        collection.name,
        "records"
      )}/{documentId} {
      allow create: if request.auth != null
        && request.resource.data.ownerId == request.auth.uid;
      allow read, update, delete: if request.auth != null
        && resource.data.ownerId == request.auth.uid
        && (!('ownerId' in request.resource.data)
          || request.resource.data.ownerId == request.auth.uid);
    }`
    )
    .join("\n\n");
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
${rules || "    match /{document=**} { allow read, write: if false; }"}
  }
}`;
}

export function buildBackendProvisioningPlan(
  appSpec: ApplicationSpec,
  selection: BackendSelection
): BackendProvisioningPlan {
  const authenticationProviders = appSpec.backend.authentication
    .map((provider) =>
      /authenticated users?|login|sign[ -]?in/i.test(provider)
        ? "email_password"
        : provider
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
    )
    .filter(Boolean);
  const collections = appSpec.backend.collections.map((collection) => ({
    name: safeResourceName(collection.key, "records"),
    ownerScoped: collection.ownerScoped !== false,
    fields: collection.fields,
  }));
  const indexes = appSpec.backend.indexes.map((index) => ({
    collection: safeResourceName(index.collection, "records"),
    fields: [
      { field: "ownerId", order: "ASCENDING" as const },
      ...index.fields.map((field) => ({
        field,
        order:
          index.order === "desc"
            ? ("DESCENDING" as const)
            : ("ASCENDING" as const),
      })),
    ],
  }));
  const provider =
    selection.mode === "firebase"
      ? "firebase"
      : selection.mode === "nexora_managed"
      ? "nexora-managed"
      : "none";
  const externalRequirements: string[] = [];
  if (selection.mode === "firebase") {
    externalRequirements.push(
      "Google/Firebase OAuth connection with the displayed scopes.",
      "Firebase Management, Firestore, Identity Toolkit and Firebase Rules APIs enabled.",
      "Anonymous Authentication is enabled for the generated client identity unless a requested provider replaces it."
    );
    for (const provider of authenticationProviders.filter(
      (item) => !/anonymous|email|password/.test(item)
    )) {
      externalRequirements.push(
        `Firebase Authentication provider credentials must be configured for ${provider.replace(
          /_/g,
          " "
        )} before provisioning can be verified.`
      );
    }
  }
  if (appSpec.backend.storage.length > 0) {
    externalRequirements.push(
      "A billable Google Cloud project may be required for Cloud Storage."
    );
  }
  if (appSpec.backend.functions.length > 0) {
    externalRequirements.push(
      "Cloud Functions deployment requires a configured build-artifact pipeline and a billing-enabled project."
    );
  }

  return {
    version: 1,
    provider,
    required: appSpec.backend.required,
    projectKind: appSpec.projectKind,
    region: selection.region,
    isolationMode: selection.isolationMode,
    externalProjectId: selection.firebaseProjectId,
    createProject: selection.createProject,
    authentication: {
      required: authenticationProviders.length > 0,
      providers: [...new Set(authenticationProviders)],
      anonymousPreviewIdentity: true,
    },
    collections,
    indexes,
    securityRules: firebaseRules(collections),
    storageBuckets: appSpec.backend.storage,
    functions: appSpec.backend.functions,
    environmentVariables: appSpec.backend.environmentVariables,
    seedData: [],
    externalRequirements,
    verification: {
      write: true,
      read: true,
      delete: true,
      usesClientIdentity: true,
    },
  };
}

export function isolateBackendProvisioningPlan(
  plan: BackendProvisioningPlan,
  namespace: string
): BackendProvisioningPlan {
  if (plan.provider !== "firebase" || plan.isolationMode !== "namespaced") {
    return plan;
  }
  const prefix = safeResourceName(namespace, "nexora");
  const collections = plan.collections.map((collection) => ({
    ...collection,
    name: `${prefix}_${collection.name}`.slice(0, 120),
  }));
  const names = new Map(
    plan.collections.map((collection, index) => [
      collection.name,
      collections[index].name,
    ])
  );
  const indexes = plan.indexes.map((index) => ({
    ...index,
    collection:
      names.get(index.collection) ||
      `${prefix}_${index.collection}`.slice(0, 120),
  }));
  return {
    ...plan,
    collections,
    indexes,
    securityRules: firebaseRules(collections),
    environmentVariables: [
      ...new Set([...plan.environmentVariables, "VITE_FIREBASE_NAMESPACE"]),
    ],
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export async function backendPlanHash(
  plan: BackendProvisioningPlan
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJson(plan))
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
