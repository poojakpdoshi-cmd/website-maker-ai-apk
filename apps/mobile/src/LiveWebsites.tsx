import { useEffect, useState } from "react";
import { Browser } from "@capacitor/browser";

type Deployment = {
  id: string;
  status: string;
  provider: string;
  provider_deployment_id?: string | null;
  live_url?: string | null;
  error_message?: string | null;
  created_at: string;
  ready_at?: string | null;
};

type LiveSite = {
  id: string;
  project_id: string;
  name: string;
  status: string;
  hosting_provider: string;
  live_url?: string | null;
  github_repository?: string | null;
  thumbnail_url?: string | null;
  published_at?: string | null;
  last_deployment_at?: string | null;
  latestDeployment?: Deployment | null;
};

type DeploymentLog = {
  id: string | number;
  deployment_id: string;
  event_type: string;
  status: string;
  message?: string | null;
  created_at: string;
};

type Props = {
  apiBase: string;
  token: string;
  email: string;
  installationId: string;
  onOpenProject: (projectId: string) => Promise<void>;
};

function displayDate(value?: string | null): string {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

export default function LiveWebsites({
  apiBase,
  token,
  email,
  installationId,
  onOpenProject,
}: Props) {
  const [sites, setSites] = useState<LiveSite[]>([]);
  const [selectedSite, setSelectedSite] = useState<LiveSite | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [events, setEvents] = useState<DeploymentLog[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "X-Device-Id": installationId,
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

  async function loadSites() {
    setBusy("load");
    setError("");
    try {
      const data = await read(
        await fetch(`${apiBase}/live-sites`, {
          headers: authHeaders,
        })
      );
      setSites(Array.isArray(data.sites) ? data.sites : []);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load live websites."
      );
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    void loadSites();
  }, [apiBase, token]);

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Live link copied.");
    } catch {
      setError("Could not copy the link on this device.");
    }
  }

  async function viewLogs(site: LiveSite) {
    setBusy(site.id);
    setError("");
    try {
      const data = await read(
        await fetch(`${apiBase}/live-sites/${site.id}/deployments`, {
          headers: authHeaders,
        })
      );
      setSelectedSite(site);
      setDeployments(Array.isArray(data.deployments) ? data.deployments : []);
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load deployment logs."
      );
    } finally {
      setBusy("");
    }
  }

  async function redeploy(site: LiveSite) {
    if (
      !window.confirm(
        `Redeploy ${site.name} from its latest verified project version?`
      )
    )
      return;
    setBusy(site.id);
    setError("");
    setMessage(
      "Redeployment started. The site remains unchanged until Vercel confirms success."
    );
    try {
      const data = await read(
        await fetch(`${apiBase}/projects/${site.project_id}/publish`, {
          method: "POST",
          headers: {
            ...authHeaders,
            "content-type": "application/json",
          },
          body: JSON.stringify({ email, installationId }),
        })
      );
      setMessage(
        data.live
          ? "Redeployment is live."
          : `Deployment state: ${String(
              data.state || "building"
            )}. Refresh for the confirmed result.`
      );
      await loadSites();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Redeployment failed."
      );
    } finally {
      setBusy("");
    }
  }

  async function unpublish(site: LiveSite) {
    if (
      !window.confirm(
        `Unpublish ${site.name}? Its deployment history will remain available.`
      )
    )
      return;
    setBusy(site.id);
    setError("");
    try {
      await read(
        await fetch(`${apiBase}/live-sites/${site.id}/unpublish`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      setMessage(`${site.name} is no longer marked live.`);
      await loadSites();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not unpublish the website."
      );
    } finally {
      setBusy("");
    }
  }

  async function deleteDeployment(site: LiveSite, deployment: Deployment) {
    if (
      !window.confirm(
        "Permanently delete this hosting deployment? This cannot be undone."
      )
    )
      return;
    setBusy(deployment.id);
    setError("");
    try {
      await read(
        await fetch(
          `${apiBase}/live-sites/${site.id}/deployments/${deployment.id}`,
          { method: "DELETE", headers: authHeaders }
        )
      );
      setMessage(
        "Deployment deleted from the hosting provider and Nexora history."
      );
      await viewLogs(site);
      await loadSites();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not delete the deployment."
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel live-websites-panel">
      <div className="live-websites-heading">
        <div>
          <p className="eyebrow">MY LIVE WEBSITES</p>
          <h2>Published sites and deployments</h2>
          <p className="muted">
            Server-backed history for this authenticated account. A site appears
            live only after the hosting provider confirms readiness.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSites()}
          disabled={Boolean(busy)}
        >
          {busy === "load" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {message && <p className="success">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="live-site-grid">
        {sites.map((site) => (
          <article key={site.id} className="live-site-card">
            <div
              className="live-site-thumbnail"
              aria-label={`Safe preview for ${site.name}`}
            >
              {site.thumbnail_url ? (
                <img
                  src={site.thumbnail_url}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div>
                  <span>{site.name.slice(0, 1).toUpperCase()}</span>
                  <small>Verified live deployment</small>
                </div>
              )}
            </div>
            <div className="live-site-details">
              <div>
                <h3>{site.name}</h3>
                <span
                  className={`deployment-status deployment-status--${site.status}`}
                >
                  {site.latestDeployment?.status || site.status}
                </span>
              </div>
              <dl>
                <div>
                  <dt>Live URL</dt>
                  <dd>{site.live_url || "Awaiting provider confirmation"}</dd>
                </div>
                <div>
                  <dt>Host</dt>
                  <dd>{site.hosting_provider}</dd>
                </div>
                <div>
                  <dt>Published</dt>
                  <dd>{displayDate(site.published_at)}</dd>
                </div>
                <div>
                  <dt>Last deployment</dt>
                  <dd>{displayDate(site.last_deployment_at)}</dd>
                </div>
                <div>
                  <dt>GitHub</dt>
                  <dd>{site.github_repository || "Not linked"}</dd>
                </div>
              </dl>
            </div>
            <div className="live-site-actions">
              <button
                type="button"
                disabled={!site.live_url}
                onClick={() =>
                  site.live_url && Browser.open({ url: site.live_url })
                }
              >
                Open Website
              </button>
              <button
                type="button"
                disabled={!site.live_url}
                onClick={() => site.live_url && void copyLink(site.live_url)}
              >
                Copy Live Link
              </button>
              <button
                type="button"
                onClick={() => void onOpenProject(site.project_id)}
              >
                Edit Website
              </button>
              <button
                type="button"
                onClick={() => void onOpenProject(site.project_id)}
              >
                Open Project Studio
              </button>
              <button
                type="button"
                onClick={() => void redeploy(site)}
                disabled={busy === site.id}
              >
                Redeploy
              </button>
              <button
                type="button"
                onClick={() => void viewLogs(site)}
                disabled={busy === site.id}
              >
                View Deployment Logs
              </button>
              <button
                type="button"
                onClick={() => void unpublish(site)}
                disabled={busy === site.id}
              >
                Unpublish
              </button>
            </div>
          </article>
        ))}
        {!sites.length && busy !== "load" && (
          <div className="empty compact">
            No provider-confirmed live websites yet.
          </div>
        )}
      </div>

      {selectedSite && (
        <div
          className="deployment-log-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Deployments for ${selectedSite.name}`}
        >
          <section>
            <div className="deployment-log-heading">
              <div>
                <p className="eyebrow">DEPLOYMENT LOGS</p>
                <h3>{selectedSite.name}</h3>
              </div>
              <button type="button" onClick={() => setSelectedSite(null)}>
                Close
              </button>
            </div>
            {deployments.map((deployment) => (
              <article key={deployment.id}>
                <div>
                  <strong>
                    {deployment.provider} · {deployment.status}
                  </strong>
                  <small>{displayDate(deployment.created_at)}</small>
                  {deployment.error_message && (
                    <p className="error">{deployment.error_message}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() =>
                    void deleteDeployment(selectedSite, deployment)
                  }
                  disabled={busy === deployment.id}
                >
                  Delete Deployment
                </button>
                <ul>
                  {events
                    .filter((event) => event.deployment_id === deployment.id)
                    .map((event) => (
                      <li key={event.id}>
                        <strong>{event.event_type.replace(/_/g, " ")}</strong>
                        <span>{event.message || event.status}</span>
                        <small>{displayDate(event.created_at)}</small>
                      </li>
                    ))}
                </ul>
              </article>
            ))}
            {!deployments.length && (
              <p className="muted">No deployment records.</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
