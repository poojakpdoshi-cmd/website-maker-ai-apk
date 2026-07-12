export type FullStackProjectFile = {
  path: string;
  content: string;
};

const fullStackRequestPattern =
  /\b(backend|back-end|database|db|supabase|firebase|mongodb|postgres|mysql|api|server|authentication|auth|login|signup|sign-up|admin panel|dashboard|orders?|payments?|cart|checkout|bookings?|appointments?|attendance|marks|inventory|enquir(?:y|ies)|contact form|save data|user accounts?|roles?|whatsapp automation)\b/i;

const fakeBackendPattern =
  /\b(mock api|fake api|demo only|localstorage only|frontend only|static data|placeholder backend|simulate(?:d)? backend)\b/i;

export function requiresFullStack(
  request: string
): boolean {
  return fullStackRequestPattern.test(request);
}

export const FULLSTACK_GENERATION_POLICY = `
WEBFORGE FULL-STACK GENERATION POLICY

When the user's request includes backend, database, authentication,
accounts, admin features, forms that save data, orders, bookings,
payments, inventory, attendance, marks, enquiries, dashboards or APIs:

1. Generate a REAL connected full-stack project, not a UI-only demo.
2. The frontend must call working backend/API functions.
3. Include a real database schema with migrations.
4. Include authentication and authorization when accounts or admin
   access are requested.
5. Include server-side input validation and useful error responses.
6. Include database indexes, ownership checks and security policies.
7. Never expose service-role keys, private tokens or secrets in the
   frontend.
8. Include an .env.example containing variable names only.
9. Include setup/deployment documentation.
10. Include loading, empty, success and failure states in the frontend.
11. Do not use localStorage as the main database.
12. Do not label unfinished mock functionality as production-ready.
13. All generated code must pass the existing independent validation
    checks and a real successful build before deployment.

Minimum deliverables for a requested full-stack website:
- frontend application
- backend/API implementation
- database migration/schema
- frontend-to-backend integration
- environment example
- setup documentation
- authentication/security implementation when applicable
`.trim();

export function buildFullStackInstruction(
  request: string
): string {
  if (!requiresFullStack(request)) {
    return '';
  }

  return `

${FULLSTACK_GENERATION_POLICY}

This request has been classified as FULL-STACK.
The final generated files must satisfy every requirement above.
`;
}

export function validateFullStackArtifacts(
  request: string,
  files: FullStackProjectFile[]
): string[] {
  if (!requiresFullStack(request)) {
    return [];
  }

  const issues: string[] = [];
  const paths = files.map((file) =>
    file.path.toLowerCase()
  );

  const allContent = files
    .map((file) => file.content)
    .join('\n')
    .toLowerCase();

  const hasBackend = paths.some((path) =>
    /(^|\/)(api|server|backend|functions|workers?)(\/|$)/.test(
      path
    )
  ) || /\b(app\.(get|post|put|patch|delete)|router\.|serve\(|hono|express|serverless)\b/.test(
    allContent
  );

  const hasDatabase = paths.some((path) =>
    /(migration|migrations|schema\.sql|supabase|prisma|drizzle)/.test(
      path
    )
  ) || /\b(create table|alter table|prisma schema|drizzle|supabase)\b/.test(
    allContent
  );

  const hasEnvironmentExample = paths.some(
    (path) =>
      path.endsWith('.env.example') ||
      path.endsWith('env.example')
  );

  const hasDocumentation = paths.some(
    (path) =>
      path.endsWith('readme.md') ||
      path.includes('/docs/')
  );

  const hasFrontendApiConnection =
    /\b(fetch|axios|supabase\.from|supabase\.auth|graphql|trpc)\b/.test(
      allContent
    );

  if (!hasBackend) {
    issues.push(
      'Full-stack request is missing a real backend/API implementation.'
    );
  }

  if (!hasDatabase) {
    issues.push(
      'Full-stack request is missing a database schema or migration.'
    );
  }

  if (!hasFrontendApiConnection) {
    issues.push(
      'Frontend is not connected to the generated backend or database.'
    );
  }

  if (!hasEnvironmentExample) {
    issues.push(
      'Full-stack project is missing an .env.example file.'
    );
  }

  if (!hasDocumentation) {
    issues.push(
      'Full-stack project is missing setup documentation.'
    );
  }

  if (fakeBackendPattern.test(allContent)) {
    issues.push(
      'Full-stack project still contains fake, simulated or frontend-only backend behavior.'
    );
  }

  return issues;
}
