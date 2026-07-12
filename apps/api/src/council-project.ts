import type {
  GeneratedProject,
  GeneratedProjectFile
} from '@wmai/shared';

export type CouncilProjectPatch = {
  files: GeneratedProjectFile[];
  previewHtml?: string;
  summary?: string;
};

const allowedFiles = new Set([
  'src/App.jsx',
  'src/styles.css',
  'public/logo.svg',
  'README.md'
]);

function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('Council agent returned no JSON object.');
  }

  return JSON.parse(raw.slice(start, end + 1));
}

function isAllowedGeneratedPath(
  path: string
): boolean {
  if (allowedFiles.has(path)) {
    return true;
  }

  const exactFiles = new Set([
    '.env.example',
    'README.md',
    'vercel.json',
    'wrangler.toml',
    'wrangler.jsonc',
    'prisma/schema.prisma'
  ]);

  if (exactFiles.has(path)) {
    return true;
  }

  const fullStackPaths = [
    /^(api|server|backend|functions|workers)\/[A-Za-z0-9._/-]+\.(ts|tsx|js|mjs|cjs|json|sql)$/,
    /^src\/(api|server|backend|services|lib)\/[A-Za-z0-9._/-]+\.(ts|tsx|js|mjs|cjs|json|sql)$/,
    /^supabase\/migrations\/[A-Za-z0-9._-]+\.sql$/,
    /^supabase\/functions\/[A-Za-z0-9._/-]+\.(ts|js|json)$/,
    /^migrations\/[A-Za-z0-9._-]+\.sql$/,
    /^drizzle\/[A-Za-z0-9._/-]+\.(ts|js|json|sql)$/
  ];

  return fullStackPaths.some(
    (rule) => rule.test(path)
  );
}

function cleanPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const path = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  if (
    !isAllowedGeneratedPath(path) ||
    path.includes('..') ||
    path.includes('\\')
  ) {
    return null;
  }

  return path;
}

function cleanContent(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const content = value
    .replace(/^```[a-z0-9_-]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!content || content.length > 350000) {
    return null;
  }

  return content;
}

export function parseCouncilProjectPatch(
  raw: string
): CouncilProjectPatch {
  const parsed = extractJson(raw);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Council output is not an object.');
  }

  const record = parsed as Record<string, unknown>;
  const rawFiles = Array.isArray(record.files)
    ? record.files
    : [];

  const files: GeneratedProjectFile[] = [];

  for (const item of rawFiles) {
    if (!item || typeof item !== 'object') continue;

    const file = item as Record<string, unknown>;
    const path = cleanPath(file.path);
    const content = cleanContent(file.content);

    if (!path || !content) continue;

    files.push({
      path,
      content
    });
  }

  const uniqueFiles = [
    ...new Map(
      files.map((file) => [file.path, file])
    ).values()
  ];

  const previewHtml =
    typeof record.previewHtml === 'string' &&
    record.previewHtml.trim().length >= 100 &&
    record.previewHtml.length <= 700000
      ? record.previewHtml.trim()
      : undefined;

  const summary =
    typeof record.summary === 'string'
      ? record.summary.trim().slice(0, 500)
      : undefined;

  if (!uniqueFiles.length && !previewHtml) {
    throw new Error(
      'Council agent returned no usable project changes.'
    );
  }

  return {
    files: uniqueFiles,
    previewHtml,
    summary
  };
}

export function applyCouncilProjectPatch(
  project: GeneratedProject,
  patch: CouncilProjectPatch
): GeneratedProject {
  const replacements = new Map(
    patch.files.map((file) => [file.path, file.content])
  );

  const files = project.files.map((file) => ({
    ...file,
    content: replacements.get(file.path) ?? file.content
  }));

  for (const file of patch.files) {
    if (!files.some((existing) => existing.path === file.path)) {
      files.push(file);
    }
  }

  return {
    ...project,
    files,
    previewHtml: patch.previewHtml || project.previewHtml
  };
}
