# GitHub and Vercel Account Connections

The app never asks users for GitHub or Vercel passwords. Users authorize access on the providers' official pages.

## GitHub OAuth App

1. In GitHub developer settings, create an OAuth App.
2. Set the homepage to your app or admin URL.
3. Set the callback URL to:

```text
https://YOUR-WORKER.workers.dev/integrations/github/callback
```

4. Copy the Client ID and Client Secret into the Worker secrets.
5. The app requests repository and user identity permissions so it can create the generated repository and push files.

## Vercel Integration

1. In Vercel's Integrations Console, create an integration.
2. Set the redirect URL to:

```text
https://YOUR-WORKER.workers.dev/integrations/vercel/callback
```

3. Enable permissions for user/team, project and deployment access.
4. Copy the Client ID, Client Secret and URL slug into Worker secrets.
5. The app starts installation using the integration's `/new` installation flow.

## Publishing flow

```text
Generate React project
→ Review preview
→ Connect GitHub
→ Connect Vercel
→ Press Push + deploy
→ Repository created in user's GitHub
→ Production deployment created in user's Vercel
→ .vercel.app URL saved in the project
```

V2 deploys the generated files directly through Vercel's deployment API. The GitHub repository is still created and populated for ownership and future versions.
