import {
  requiresFullStack,
  validateFullStackArtifacts,
  type FullStackProjectFile
} from './fullstack-policy';

export type FullStackReport = {
  requested: boolean;
  ready: boolean;
  capabilities: {
    backendApi: boolean;
    database: boolean;
    migrations: boolean;
    authentication: boolean;
    authorization: boolean;
    writeOperations: boolean;
    environmentExample: boolean;
    setupDocumentation: boolean;
  };
  issues: string[];
};

export function createFullStackReport(
  request: string,
  files: FullStackProjectFile[]
): FullStackReport {
  const paths = files.map((file) =>
    file.path.replace(/\\/g, '/').toLowerCase()
  );

  const content = files
    .map((file) => file.content)
    .join('\n');

  const capabilities = {
    backendApi:
      paths.some((path) =>
        /^(api|server|backend|functions|workers)\//.test(path)
      ) ||
      paths.some((path) =>
        /^(app|src)\/api\//.test(path)
      ) ||
      /\b(getFirestore|onSnapshot|subscribeRecords)\b/i.test(content),

    database:
      paths.some((path) =>
        /(supabase|prisma|drizzle|migration|schema\.sql|firebase|firestore)/.test(
          path
        )
      ) ||
      /\b(create table|prisma|drizzle|supabase\.from|getFirestore|firestore)\b/i.test(
        content
      ),

    migrations:
      paths.some((path) =>
        /(migrations?\/.*\.sql|schema\.sql|schema\.prisma|firestore\.rules|firestore\.indexes\.json)$/.test(
          path
        )
      ),

    authentication:
      /\b(supabase\.auth|signInWith|signUp|signInAnonymously|verifySession|requireAuth|jwt\.verify|getServerSession)\b/i.test(
        content
      ),

    authorization:
      /\b(requireAdmin|isAdmin|roles?|permissions?|create policy|row level security|rls|ownerId|request\.auth)\b/i.test(
        content
      ),

    writeOperations:
      /\b(app|router)\.(post|put|patch|delete)\b/i.test(
        content
      ) ||
      /\bexport\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/i.test(
        content
      ) ||
      /\.(insert|update|upsert|delete)\s*\(/i.test(
        content
      ) ||
      /\b(addDoc|setDoc|deleteDoc)\s*\(/i.test(
        content
      ),

    environmentExample:
      paths.some((path) =>
        path.endsWith('.env.example')
      ),

    setupDocumentation:
      paths.some((path) =>
        path.endsWith('readme.md') ||
        path.includes('/docs/')
      )
  };

  const requested = requiresFullStack(request);

  const issues = validateFullStackArtifacts(
    request,
    files
  );

  return {
    requested,
    ready: !requested || issues.length === 0,
    capabilities,
    issues
  };
}
