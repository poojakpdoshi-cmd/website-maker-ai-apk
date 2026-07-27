import { useEffect, useState } from "react";
import { Browser } from "@capacitor/browser";

type BackendMode = "none" | "nexora_managed" | "firebase";
type BackendState = {
  mode: BackendMode;
  status: string;
  verified_at?: string | null;
  verification_details?: Record<string, unknown>;
} | null;

type FirebaseProject = {
  projectId: string;
  displayName?: string;
  state?: string;
};

type BackendPlan = {
  provider: string;
  required: boolean;
  region: string;
  isolationMode: string;
  authentication: { required: boolean; providers: string[] };
  collections: Array<{
    name: string;
    ownerScoped: boolean;
    fields: Array<{
      key: string;
      label: string;
      type: string;
      required?: boolean;
    }>;
  }>;
  indexes: Array<{
    collection: string;
    fields: Array<{ field: string; order: string }>;
  }>;
  storageBuckets: string[];
  functions: string[];
  environmentVariables: string[];
  externalRequirements: string[];
};

type Props = {
  apiBase: string;
  projectId: string;
  token: string;
  backendRequired: boolean;
  onStateChange: (backend: BackendState) => void;
};

const regions = [
  ["us-central1", "Iowa, USA"],
  ["us-east1", "South Carolina, USA"],
  ["europe-west1", "Belgium, Europe"],
  ["asia-south1", "Mumbai, India"],
  ["asia-southeast1", "Singapore"],
  ["australia-southeast1", "Sydney, Australia"],
] as const;

export default function BackendWizard({
  apiBase,
  projectId,
  token,
  backendRequired,
  onStateChange,
}: Props) {
  const [backend, setBackend] = useState<BackendState>(null);
  const [mode, setMode] = useState<BackendMode>(
    backendRequired ? "nexora_managed" : "none"
  );
  const [region, setRegion] = useState("asia-south1");
  const [isolationMode, setIsolationMode] = useState<
    "separate_project" | "named_database" | "namespaced"
  >("namespaced");
  const [firebaseConnected, setFirebaseConnected] = useState(false);
  const [firebaseAccount, setFirebaseAccount] = useState("");
  const [firebaseProjects, setFirebaseProjects] = useState<FirebaseProject[]>(
    []
  );
  const [firebaseProjectId, setFirebaseProjectId] = useState("");
  const [createNewProject, setCreateNewProject] = useState(false);
  const [newProjectId, setNewProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [allowProjectCreation, setAllowProjectCreation] = useState(false);
  const [plan, setPlan] = useState<BackendPlan | null>(null);
  const [confirmationHash, setConfirmationHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const headers = {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  async function read(response: Response) {
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      any
    >;
    if (!response.ok)
      throw new Error(
        String(data.error || `Request failed (${response.status}).`)
      );
    return data;
  }

  async function refreshBackend() {
    const response = await fetch(`${apiBase}/projects/${projectId}/backend`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await read(response);
    const next = (data.backend || null) as BackendState;
    setBackend(next);
    if (next?.mode) setMode(next.mode);
    onStateChange(next);
  }

  async function refreshFirebase() {
    const response = await fetch(`${apiBase}/integrations/firebase/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await read(response);
    setFirebaseConnected(Boolean(data.connected));
    setFirebaseAccount(String(data.connection?.external_account_name || ""));
    if (data.connected) {
      const projectsResponse = await fetch(
        `${apiBase}/backend/firebase/projects`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const projectsData = await read(projectsResponse);
      setFirebaseProjects(
        Array.isArray(projectsData.projects) ? projectsData.projects : []
      );
    } else {
      setFirebaseProjects([]);
    }
  }

  useEffect(() => {
    setPlan(null);
    setConfirmationHash("");
    setError("");
    void Promise.all([refreshBackend(), refreshFirebase()]).catch((reason) => {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load backend setup."
      );
    });
  }, [projectId, token]);

  async function connectFirebase() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `${apiBase}/integrations/firebase/start?createProject=${allowProjectCreation}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await read(response);
      await Browser.open({ url: String(data.url) });
      setMessage(
        "Complete Google sign-in, return here, then tap Refresh Firebase status."
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not start Firebase sign-in."
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnectFirebase() {
    if (
      !window.confirm(
        "Disconnect Firebase from this Nexora account? Existing Firebase resources will not be deleted."
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await read(
        await fetch(`${apiBase}/integrations/firebase`, {
          method: "DELETE",
          headers,
        })
      );
      await refreshFirebase();
      setMessage(
        "Firebase disconnected. Existing external resources were left intact."
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not disconnect Firebase."
      );
    } finally {
      setBusy(false);
    }
  }

  async function reviewPlan() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const selection: Record<string, unknown> = {
        mode,
        region,
        isolationMode,
      };
      if (mode === "firebase") {
        if (createNewProject) {
          selection.createProject = {
            projectId: newProjectId.trim(),
            displayName: newProjectName.trim(),
          };
        } else {
          selection.firebaseProjectId = firebaseProjectId;
        }
      }
      const data = await read(
        await fetch(`${apiBase}/projects/${projectId}/backend/plan`, {
          method: "POST",
          headers,
          body: JSON.stringify(selection),
        })
      );
      setPlan(data.plan as BackendPlan);
      setConfirmationHash(String(data.confirmationHash));
      setMessage(
        "Review every resource below. Nothing external has been created yet."
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not create the backend plan."
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmPlan() {
    if (!plan || !confirmationHash) return;
    if (
      !window.confirm(
        "Create and verify exactly the backend resources shown in this plan?"
      )
    )
      return;
    setBusy(true);
    setError("");
    setMessage(
      "Creating resources and running a real write/read/delete verification…"
    );
    try {
      const data = await read(
        await fetch(`${apiBase}/projects/${projectId}/backend/confirm`, {
          method: "POST",
          headers,
          body: JSON.stringify({ confirmationHash }),
        })
      );
      await refreshBackend();
      if (data.status === "verified") {
        setMessage("Backend verified. Publishing is now enabled.");
      } else {
        setMessage(
          `Backend status: ${String(
            data.status || "partial"
          )}. Resolve the reported requirement before publishing.`
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Backend provisioning failed."
      );
      await refreshBackend().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="backend-wizard" aria-labelledby="backend-wizard-title">
      <div className="backend-wizard-heading">
        <div>
          <p className="eyebrow">BACKEND &amp; DATABASE</p>
          <h3 id="backend-wizard-title">
            Prepare persistence before publishing
          </h3>
          <p className="muted">
            Nexora derives this plan from the binding application specification.
            External resources are created only after your confirmation.
          </p>
        </div>
        <span
          className={`backend-state backend-state--${
            backend?.status || "not-configured"
          }`}
        >
          {backend?.status?.replace(/_/g, " ") || "Not configured"}
        </span>
      </div>

      <div className="backend-choice-grid">
        {(
          [
            [
              "none",
              "No backend required",
              "For static sites only. Functional apps that require persistence cannot use this.",
            ],
            [
              "nexora_managed",
              "Nexora-managed backend",
              "Owner-scoped managed data storage without another account.",
            ],
            [
              "firebase",
              "Connect Firebase",
              "Firestore, Authentication, Rules, indexes and isolated resource mapping.",
            ],
          ] as const
        ).map(([id, label, detail]) => (
          <button
            type="button"
            key={id}
            className={mode === id ? "selected" : ""}
            onClick={() => {
              setMode(id);
              setPlan(null);
              setConfirmationHash("");
            }}
            disabled={busy}
          >
            <strong>{label}</strong>
            <small>{detail}</small>
          </button>
        ))}
      </div>

      <div className="backend-options">
        <label>
          Region
          <select
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          >
            {regions.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Resource isolation
          <select
            value={isolationMode}
            onChange={(event) =>
              setIsolationMode(event.target.value as typeof isolationMode)
            }
          >
            <option value="namespaced">Namespaced collections</option>
            <option value="named_database">Separate named database</option>
            <option value="separate_project">Separate Firebase project</option>
          </select>
        </label>
      </div>

      {mode === "firebase" && (
        <section className="firebase-connect-card">
          <div>
            <strong>
              {firebaseConnected
                ? "Firebase connected"
                : "Firebase not connected"}
            </strong>
            <small>
              {firebaseConnected
                ? firebaseAccount
                : "Sign in with Google. Private service-account keys are never requested."}
            </small>
          </div>
          <div className="backend-inline-actions">
            <label className="backend-permission-toggle">
              <input
                type="checkbox"
                checked={allowProjectCreation}
                onChange={(event) =>
                  setAllowProjectCreation(event.target.checked)
                }
              />
              Allow project creation scope
            </label>
            <button type="button" onClick={connectFirebase} disabled={busy}>
              {firebaseConnected ? "Reconnect" : "Connect with Google"}
            </button>
            <button
              type="button"
              onClick={() => void refreshFirebase()}
              disabled={busy}
            >
              Refresh Firebase status
            </button>
            {firebaseConnected && (
              <button
                type="button"
                className="danger-button"
                onClick={disconnectFirebase}
                disabled={busy}
              >
                Disconnect
              </button>
            )}
          </div>

          {firebaseConnected && (
            <>
              <label className="backend-permission-toggle">
                <input
                  type="checkbox"
                  checked={createNewProject}
                  onChange={(event) =>
                    setCreateNewProject(event.target.checked)
                  }
                />
                Create a new Firebase project
              </label>
              {createNewProject ? (
                <div className="backend-options">
                  <label>
                    New project ID
                    <input
                      value={newProjectId}
                      onChange={(event) => setNewProjectId(event.target.value)}
                      placeholder="my-nexora-project"
                    />
                  </label>
                  <label>
                    Display name
                    <input
                      value={newProjectName}
                      onChange={(event) =>
                        setNewProjectName(event.target.value)
                      }
                      placeholder="My Nexora App"
                    />
                  </label>
                </div>
              ) : (
                <label>
                  Existing Firebase project
                  <select
                    value={firebaseProjectId}
                    onChange={(event) =>
                      setFirebaseProjectId(event.target.value)
                    }
                  >
                    <option value="">Select a project</option>
                    {firebaseProjects.map((project) => (
                      <option value={project.projectId} key={project.projectId}>
                        {project.displayName || project.projectId} (
                        {project.projectId})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={reviewPlan}
        disabled={
          busy ||
          (mode === "firebase" &&
            (!firebaseConnected ||
              (createNewProject
                ? !allowProjectCreation ||
                  newProjectId.trim().length < 5 ||
                  newProjectName.trim().length < 3
                : !firebaseProjectId)))
        }
      >
        {busy ? "Working…" : "Review backend plan"}
      </button>

      {plan && (
        <section className="backend-plan-review">
          <h4>Confirm the exact resource plan</h4>
          <dl>
            <div>
              <dt>Provider</dt>
              <dd>{plan.provider}</dd>
            </div>
            <div>
              <dt>Region</dt>
              <dd>{plan.region}</dd>
            </div>
            <div>
              <dt>Isolation</dt>
              <dd>{plan.isolationMode.replace(/_/g, " ")}</dd>
            </div>
            <div>
              <dt>Authentication</dt>
              <dd>
                {plan.authentication.required
                  ? plan.authentication.providers.join(", ") || "Required"
                  : "Not requested"}
              </dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>{plan.storageBuckets.join(", ") || "None"}</dd>
            </div>
            <div>
              <dt>Functions / API</dt>
              <dd>{plan.functions.join(", ") || "None"}</dd>
            </div>
          </dl>
          <h4>Collections and fields</h4>
          {plan.collections.length ? (
            plan.collections.map((collection) => (
              <article key={collection.name}>
                <strong>{collection.name}</strong>
                <small>
                  {collection.ownerScoped ? "Owner-scoped" : "Shared"} ·{" "}
                  {collection.fields
                    .map((field) => `${field.label} (${field.type})`)
                    .join(", ")}
                </small>
              </article>
            ))
          ) : (
            <p className="muted">No collections requested.</p>
          )}
          <h4>Rules, indexes and environment</h4>
          <p className="muted">
            {plan.indexes.length} composite index(es). Generated ownership rules
            deny unauthenticated document access.
          </p>
          <code>
            {plan.environmentVariables.join(", ") ||
              "No public environment variables"}
          </code>
          {plan.externalRequirements.length > 0 && (
            <>
              <h4>External requirements</h4>
              <ul>
                {plan.externalRequirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          <button type="button" onClick={confirmPlan} disabled={busy}>
            {busy ? "Creating and verifying…" : "Create Backend & Continue"}
          </button>
        </section>
      )}

      {message && <p className="success">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
