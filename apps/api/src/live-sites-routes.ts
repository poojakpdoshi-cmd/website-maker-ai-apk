import type { SupabaseClient } from "@supabase/supabase-js";

type Deps = {
  authenticatedEmail: (c: any) => Promise<string | null>;
  requireSupabase: (env: any) => SupabaseClient;
};

export function registerLiveSiteReadRoutes(
  app: { get: (...args: any[]) => unknown },
  deps: Deps
): void {
  app.get("/live-sites", async (c: any) => {
    const email = await deps.authenticatedEmail(c);
    if (!email) {
      return c.json(
        { error: "Your login session is missing or expired." },
        401
      );
    }
    const supabase = deps.requireSupabase(c.env);
    const { data: sites, error } = await supabase
      .from("published_sites")
      .select(
        "id,project_id,name,status,hosting_provider,live_url,github_repository,thumbnail_url,published_at,last_deployment_at,created_at,updated_at"
      )
      .eq("owner_email", email)
      .neq("status", "deleted")
      .order("last_deployment_at", { ascending: false })
      .limit(100);
    if (error) return c.json({ error: "Could not load live websites." }, 500);

    const siteIds = (sites || []).map((site) => String(site.id));
    const deployments = siteIds.length
      ? await supabase
          .from("site_deployments")
          .select(
            "id,site_id,status,provider,provider_deployment_id,live_url,error_message,created_at,started_at,ready_at,completed_at"
          )
          .eq("owner_email", email)
          .in("site_id", siteIds)
          .order("created_at", { ascending: false })
      : { data: [], error: null };
    if (deployments.error) {
      return c.json({ error: "Could not load deployment status." }, 500);
    }
    const latestBySite = new Map<string, Record<string, unknown>>();
    for (const deployment of deployments.data || []) {
      const siteId = String(deployment.site_id);
      if (!latestBySite.has(siteId)) latestBySite.set(siteId, deployment);
    }
    return c.json({
      sites: (sites || []).map((site) => ({
        ...site,
        latestDeployment: latestBySite.get(String(site.id)) || null,
      })),
    });
  });

  app.get("/live-sites/:id/deployments", async (c: any) => {
    const email = await deps.authenticatedEmail(c);
    if (!email) {
      return c.json(
        { error: "Your login session is missing or expired." },
        401
      );
    }
    const supabase = deps.requireSupabase(c.env);
    const { data: site } = await supabase
      .from("published_sites")
      .select("id,project_id,name")
      .eq("id", c.req.param("id"))
      .eq("owner_email", email)
      .maybeSingle();
    if (!site) return c.json({ error: "Live website not found." }, 404);
    const { data: deployments, error } = await supabase
      .from("site_deployments")
      .select(
        "id,status,provider,provider_project_id,provider_deployment_id,live_url,error_message,created_at,started_at,ready_at,completed_at"
      )
      .eq("site_id", site.id)
      .eq("owner_email", email)
      .order("created_at", { ascending: false });
    if (error) return c.json({ error: "Could not load deployments." }, 500);
    const deploymentIds = (deployments || []).map((item) => String(item.id));
    const events = deploymentIds.length
      ? await supabase
          .from("deployment_events")
          .select(
            "id,deployment_id,event_type,status,message,metadata,created_at"
          )
          .eq("owner_email", email)
          .in("deployment_id", deploymentIds)
          .order("created_at", { ascending: false })
      : { data: [], error: null };
    if (events.error)
      return c.json({ error: "Could not load deployment logs." }, 500);
    return c.json({
      site,
      deployments: deployments || [],
      events: events.data || [],
    });
  });
}
