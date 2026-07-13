export type SecurityAuditFile = {
  path: string;
  content: string;
};

export type SecurityAuditResult = {
  passed: boolean;
  checks: Record<string, boolean>;
  errors: string[];
  warnings: string[];
};

export const WEBFORGE_SECURITY_AUDIT_POLICY = `
WEBFORGE FIVE-LAYER SECURITY AUDIT

LAYER 1 — SECRET LEAK PREVENTION
- Never hardcode API keys, passwords, tokens, private keys,
  service-role keys, database URLs or OAuth client secrets.
- Private secrets must remain server-side in environment secrets.
- .env.example must contain variable names only.
- Never expose secrets in logs, errors, preview HTML or mobile code.
- Treat previously leaked credentials as compromised and rotate them.

LAYER 2 — PERSONAL DATA FLOW
- Identify where emails, phone numbers, addresses, passwords,
  payment data, IP addresses and device information are collected.
- Never log passwords, tokens, personal data or authorization headers.
- Hash passwords with a modern password-hashing algorithm.
- Collect and return only fields actually required.
- Do not store sensitive user data in localStorage.
- Add account deletion or anonymisation when user accounts are stored.

LAYER 3 — PRE-DEPLOY PRODUCTION SAFETY
- Remove debug routes, test credentials, TODO security bypasses
  and verbose stack traces.
- Return generic client errors and keep detailed errors server-side.
- Add secure response headers.
- Apply strict CORS instead of wildcard origins for private APIs.
- Rate-limit login, signup, OTP, password reset, uploads and public forms.
- Production databases must require authenticated encrypted access.
- Fail safely when required environment variables are missing.

LAYER 4 — COMPLEX LOGIC AUDIT
- Every protected API route must verify authentication server-side.
- Every record lookup must verify ownership or explicit authorization.
- Admin and staff routes require server-side role checks.
- Tokens must be random, expiring, revocable and user-bound.
- Payment totals, discounts and final status must be verified server-side.
- Validate every body, query, URL parameter and uploaded file.
- Prevent SQL injection, XSS, unsafe redirects and path traversal.
- File uploads need type, size and filename controls.

LAYER 5 — ATTACKER PERSPECTIVE
- Block IDOR by verifying ownership after every ID lookup.
- Block privilege escalation and hidden-UI-only authorization.
- Add abuse limits to account creation, messages, uploads and API calls.
- Escape user content before rendering it as HTML.
- Do not expose internal URLs, environment data, stack traces,
  repository paths, database details or health diagnostics publicly.
- Test business rules against negative values, duplicate rewards,
  replayed requests and repeated free actions.

A generated project cannot be called production-ready when a blocking
security issue remains. Fix blocking issues before publishing.
`.trim();

const frontendPath =
  /^(src|app|pages|components|public|apps\/mobile)\//i;

const serverPath =
  /^(api|server|backend|functions|workers|src\/server|src\/backend)\//i;

export function auditGeneratedSecurity(
  files: SecurityAuditFile[]
): SecurityAuditResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const allContent = files
    .map((file) => file.content)
    .join('\n');

  const frontendContent = files
    .filter((file) => frontendPath.test(file.path))
    .map((file) => file.content)
    .join('\n');

  const serverContent = files
    .filter((file) => serverPath.test(file.path))
    .map((file) => file.content)
    .join('\n');

  const secretPattern =
    /\b(?:gsk_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16})\b/;

  const privateVariablePattern =
    /\b(?:SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|PRIVATE_KEY|CLIENT_SECRET|API_SECRET|PASSWORD)\b\s*[:=]\s*['"`][^'"`\r\n]{8,}['"`]/i;

  const sensitiveLogPattern =
    /\b(?:console\.log|logger\.(?:info|debug)|print)\s*\([^)]*(?:password|token|authorization|cookie|email|phone|secret)/i;

  const unsafeHtmlPattern =
    /\b(?:dangerouslySetInnerHTML|innerHTML\s*=|document\.write\s*\()/i;

  const wildcardCorsPattern =
    /access-control-allow-origin['"`]?\s*[:,]\s*['"`]\*['"`]|cors\s*\(\s*\{\s*origin\s*:\s*['"`]\*['"`]/i;

  const stackLeakPattern =
    /\b(?:error\.stack|stackTrace|stack_trace)\b/i;

  const debugRoutePattern =
    /\/(?:debug|test-admin|seed-data|dev-login|admin-backdoor)\b/i;

  const clientSideAdminPattern =
    /\b(?:localStorage|getItem)\s*\([^)]*(?:role|admin)[^)]*\)[\s\S]{0,120}(?:isAdmin|admin)/i;

  const directSqlInterpolationPattern =
    /\b(?:query|execute)\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/i;

  const unsafeRedirectPattern =
    /\b(?:redirect|location\.href|window\.open)\s*\(\s*(?:req\.|request\.|params\.|query\.)/i;

  const uploadEvidence =
    /\b(?:upload|multipart|formdata|file)\b/i.test(allContent);

  const uploadProtection =
    /\b(?:fileSize|maxSize|mimeType|contentType|allowedTypes|sanitizeFilename)\b/i.test(
      serverContent
    );

  const authFeature =
    /\b(?:login|signup|signIn|signUp|password reset|otp|authentication)\b/i.test(
      allContent
    );

  const rateLimitEvidence =
    /\b(?:rateLimit|rate_limit|throttle|too many requests|429)\b/i.test(
      serverContent
    );

  const ownershipEvidence =
    /\b(?:owner_id|user_id|created_by|ownership|requireOwner|authorize|permission|role)\b/i.test(
      serverContent
    );

  const securityHeadersEvidence =
    /\b(?:x-content-type-options|content-security-policy|strict-transport-security|x-frame-options|helmet)\b/i.test(
      serverContent
    );

  if (
    secretPattern.test(allContent) ||
    privateVariablePattern.test(frontendContent)
  ) {
    errors.push(
      'Possible hardcoded private credential or API key detected.'
    );
  }

  if (sensitiveLogPattern.test(allContent)) {
    errors.push(
      'Sensitive personal or authentication data may be written to logs.'
    );
  }

  if (unsafeHtmlPattern.test(frontendContent)) {
    errors.push(
      'Unsafe HTML rendering may allow content injection or XSS.'
    );
  }

  if (wildcardCorsPattern.test(serverContent)) {
    errors.push(
      'Private API uses wildcard CORS instead of an approved-origin list.'
    );
  }

  if (stackLeakPattern.test(serverContent)) {
    warnings.push(
      'Verify that stack traces are never returned to API clients.'
    );
  }

  if (debugRoutePattern.test(serverContent)) {
    errors.push(
      'Debug, test or backdoor-style server route detected.'
    );
  }

  if (clientSideAdminPattern.test(frontendContent)) {
    errors.push(
      'Admin access appears to depend on client-side state.'
    );
  }

  if (directSqlInterpolationPattern.test(serverContent)) {
    errors.push(
      'Possible SQL injection through interpolated database query.'
    );
  }

  if (unsafeRedirectPattern.test(allContent)) {
    warnings.push(
      'User-controlled redirect destination requires an allowlist.'
    );
  }

  if (uploadEvidence && !uploadProtection) {
    errors.push(
      'File upload exists without clear server-side type and size validation.'
    );
  }

  if (authFeature && !rateLimitEvidence) {
    errors.push(
      'Authentication feature exists without clear rate limiting.'
    );
  }

  if (
    serverContent &&
    /\b(?:\/users\/:id|\/orders\/:id|\/projects\/:id|\.eq\(['"`]id['"`])/i.test(
      serverContent
    ) &&
    !ownershipEvidence
  ) {
    errors.push(
      'ID-based record access lacks clear ownership or authorization checks.'
    );
  }

  if (serverContent && !securityHeadersEvidence) {
    warnings.push(
      'No clear production security-header configuration was found.'
    );
  }

  const checks = {
    secretLeakPrevention:
      !secretPattern.test(allContent) &&
      !privateVariablePattern.test(frontendContent),

    personalDataProtection:
      !sensitiveLogPattern.test(allContent),

    productionSafety:
      !wildcardCorsPattern.test(serverContent) &&
      !debugRoutePattern.test(serverContent),

    authenticationAndAuthorization:
      !clientSideAdminPattern.test(frontendContent) &&
      (
        !/\b\/(?:users|orders|projects)\/:id\b/i.test(serverContent) ||
        ownershipEvidence
      ),

    injectionProtection:
      !unsafeHtmlPattern.test(frontendContent) &&
      !directSqlInterpolationPattern.test(serverContent),

    abuseProtection:
      !authFeature || rateLimitEvidence,

    uploadProtection:
      !uploadEvidence || uploadProtection
  };

  return {
    passed: errors.length === 0,
    checks,
    errors,
    warnings
  };
}
