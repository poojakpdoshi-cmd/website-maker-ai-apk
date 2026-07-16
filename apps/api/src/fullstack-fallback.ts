import type { GeneratedProjectFile } from '@wmai/shared';
import { requiresFullStack } from './fullstack-policy';

function normalize(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

export function ensureFullStackArtifacts(
  request: string,
  files: GeneratedProjectFile[]
): GeneratedProjectFile[] {
  if (!requiresFullStack(request)) return files;

  const result = files.map((file) => ({ ...file }));
  const paths = new Set(result.map((file) => normalize(file.path)));

  if (!paths.has('api/index.js')) {
    result.push({
      path: 'api/index.js',
      content: [
        "import { createClient } from '@supabase/supabase-js';",
        '',
        'const supabase = createClient(',
        '  process.env.SUPABASE_URL,',
        '  process.env.SUPABASE_ANON_KEY',
        ');',
        '',
        'export default async function handler(request, response) {',
        "  if (request.method === 'GET') {",
        "    const { data, error } = await supabase.from('items').select('*').order('created_at', { ascending: false });",
        "    if (error) return response.status(500).json({ error: error.message });",
        "    return response.status(200).json({ items: data });",
        '  }',
        '',
        "  if (request.method === 'POST') {",
        "    const payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;",
        "    const name = String(payload?.name || '').trim();",
        "    if (name.length < 2) return response.status(400).json({ error: 'A valid name is required.' });",
        "    const { data, error } = await supabase.from('items').insert({ name }).select().single();",
        "    if (error) return response.status(500).json({ error: error.message });",
        "    return response.status(201).json({ item: data });",
        '  }',
        '',
        "  return response.status(405).json({ error: 'Method not allowed.' });",
        '}',
        ''
      ].join('\n')
    });
  }

  if (!paths.has('supabase/migrations/001_initial_schema.sql')) {
    result.push({
      path: 'supabase/migrations/001_initial_schema.sql',
      content: [
        'create extension if not exists "pgcrypto";',
        '',
        'create table if not exists public.items (',
        '  id uuid primary key default gen_random_uuid(),',
        '  name text not null check (char_length(name) between 2 and 160),',
        '  created_at timestamptz not null default now()',
        ');',
        '',
        'create index if not exists items_created_at_idx',
        '  on public.items (created_at desc);',
        '',
        'alter table public.items enable row level security;',
        '',
        'create policy "Public can read items"',
        '  on public.items for select using (true);',
        '',
        'create policy "Public can create items"',
        '  on public.items for insert',
        '  with check (char_length(name) between 2 and 160);',
        ''
      ].join('\n')
    });
  }

  if (!paths.has('.env.example')) {
    result.push({
      path: '.env.example',
      content: 'VITE_API_BASE_URL=\nSUPABASE_URL=\nSUPABASE_ANON_KEY=\n'
    });
  }

  const appFile = result.find((file) =>
    /(^|\/)src\/app\.(jsx|tsx|js|ts)$/i.test(normalize(file.path))
  );

  if (appFile && !/\bfetch\s*\(/.test(appFile.content)) {
    appFile.content = [
      "const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';",
      appFile.content,
      '',
      'export async function loadBackendItems() {',
      '  const response = await fetch(`${API_BASE_URL}/api`);',
      "  if (!response.ok) throw new Error('Could not load backend data.');",
      '  return response.json();',
      '}',
      ''
    ].join('\n');
  }

  const readme = result.find((file) => /(^|\/)readme\.md$/i.test(normalize(file.path)));
  const setup = [
    '',
    '## Full-stack setup',
    '',
    '1. Copy `.env.example` to `.env.local`.',
    '2. Create a Supabase project.',
    '3. Run `supabase/migrations/001_initial_schema.sql`.',
    '4. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `VITE_API_BASE_URL`.',
    '5. Deploy the frontend and serverless `api/index.js` together.',
    ''
  ].join('\n');

  if (readme) {
    if (!readme.content.includes('## Full-stack setup')) readme.content += setup;
  } else {
    result.push({ path: 'README.md', content: '# Generated full-stack website\n' + setup });
  }

  const packageFile = result.find((file) => normalize(file.path) === 'package.json');
  if (packageFile) {
    try {
      const packageJson = JSON.parse(packageFile.content);
      packageJson.dependencies = {
        ...(packageJson.dependencies || {}),
        '@supabase/supabase-js': '^2.49.1'
      };
      packageFile.content = JSON.stringify(packageJson, null, 2);
    } catch {
      // Leave an invalid package file unchanged; the validator will report it.
    }
  }

  return result;
}
