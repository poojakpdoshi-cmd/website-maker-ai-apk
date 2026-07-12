import type { GeneratedProjectFile } from '@wmai/shared';

import { validateFullStackArtifacts } from './fullstack-policy';
export type ProjectValidationResult = {
  passed: boolean;
  errors: string[];
  warnings: string[];
  checks: Record<string, boolean>;
};

const requiredFiles = [
  'package.json',
  'index.html',
  'src/main.jsx',
  'src/App.jsx',
  'src/styles.css',
  'public/logo.svg',
  'vite.config.js',
  'vercel.json'
];

function objectValue(
  value: unknown
): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

export function validateGeneratedProject(
  files: GeneratedProjectFile[],
  request = ''
): ProjectValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: Record<string, boolean> = {};

  const paths = files.map((file) => file.path);
  const uniquePaths = new Set(paths);
  const byPath = new Map(
    files.map((file) => [file.path, file.content])
  );

  checks.hasFiles = files.length >= 8;
  checks.uniquePaths = uniquePaths.size === paths.length;
  checks.safePaths = paths.every(
    (path) =>
      path.length > 0 &&
      !path.startsWith('/') &&
      !path.includes('..') &&
      !path.includes('\\')
  );

  if (!checks.hasFiles) {
    errors.push('Generated project contains too few files.');
  }

  if (!checks.uniquePaths) {
    errors.push('Generated project contains duplicate file paths.');
  }

  if (!checks.safePaths) {
    errors.push('Generated project contains an unsafe file path.');
  }

  for (const required of requiredFiles) {
    if (!byPath.has(required)) {
      errors.push(`Required file is missing: ${required}`);
    }
  }

  checks.requiredFiles = requiredFiles.every(
    (required) => byPath.has(required)
  );

  for (const file of files) {
    if (!file.content.trim()) {
      errors.push(`File is empty: ${file.path}`);
    }

    if (file.content.length > 700000) {
      errors.push(`File is unexpectedly large: ${file.path}`);
    }
  }

  const totalBytes = files.reduce(
    (total, file) =>
      total +
      new TextEncoder().encode(file.content).byteLength,
    0
  );

  checks.safeProjectSize = totalBytes <= 2500000;

  if (!checks.safeProjectSize) {
    errors.push('Generated project exceeds the safe size limit.');
  }

  const combinedSource = files
    .map((file) => file.content)
    .join('\n');

  const secretPattern =
    /(?:gsk_[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|SUPABASE_SERVICE_ROLE_KEY|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/;

  checks.noEmbeddedSecrets =
    !secretPattern.test(combinedSource);

  if (!checks.noEmbeddedSecrets) {
    errors.push(
      'Generated project appears to contain a secret or private key.'
    );
  }

  let packageJson: Record<string, unknown> = {};

  try {
    packageJson = JSON.parse(
      byPath.get('package.json') || '{}'
    ) as Record<string, unknown>;

    checks.validPackageJson = true;
  } catch {
    checks.validPackageJson = false;
    errors.push('package.json is invalid JSON.');
  }

  const scripts = objectValue(packageJson.scripts);
  const dependencies = {
    ...objectValue(packageJson.dependencies),
    ...objectValue(packageJson.devDependencies)
  };

  checks.hasBuildScript =
    typeof scripts.build === 'string' &&
    scripts.build.includes('vite build');

  checks.hasReactDependencies =
    typeof dependencies.react === 'string' &&
    typeof dependencies['react-dom'] === 'string' &&
    typeof dependencies.vite === 'string';

  if (!checks.hasBuildScript) {
    errors.push('package.json has no valid Vite build script.');
  }

  if (!checks.hasReactDependencies) {
    errors.push('Required React or Vite dependencies are missing.');
  }

  const indexHtml = byPath.get('index.html') || '';
  const mainSource = byPath.get('src/main.jsx') || '';
  const appSource = byPath.get('src/App.jsx') || '';
  const styles = byPath.get('src/styles.css') || '';
  const logo = byPath.get('public/logo.svg') || '';

  checks.validHtmlEntry =
    /id=["']root["']/.test(indexHtml) &&
    /src=["']\/src\/main\.jsx["']/.test(indexHtml);

  checks.validReactEntry =
    mainSource.includes('createRoot') &&
    mainSource.includes("import App from './App.jsx'");

  checks.validAppComponent =
    appSource.includes('export default App') &&
    appSource.includes("import './styles.css'");

  checks.responsiveStyles =
    styles.includes('@media') &&
    styles.includes('box-sizing');

  checks.validLogo =
    logo.trim().startsWith('<svg') &&
    logo.includes('</svg>');

  if (!checks.validHtmlEntry) {
    errors.push('index.html does not contain a valid React entry.');
  }

  if (!checks.validReactEntry) {
    errors.push('src/main.jsx does not mount the React app correctly.');
  }

  if (!checks.validAppComponent) {
    errors.push('src/App.jsx is missing its export or stylesheet.');
  }

  if (!checks.responsiveStyles) {
    errors.push('Responsive CSS validation failed.');
  }

  if (!checks.validLogo) {
    errors.push('Generated logo.svg is invalid.');
  }

  if (!indexHtml.includes('name="viewport"')) {
    warnings.push('Viewport metadata is missing.');
  }

  if (!indexHtml.includes('name="description"')) {
    warnings.push('SEO description metadata is missing.');
  }

  if (
    /\beval\s*\(|new Function\s*\(|document\.write\s*\(/.test(
      combinedSource
    )
  ) {
    warnings.push(
      'Potentially unsafe dynamic JavaScript was detected.'
    );
  }


  const fullStackErrors =
    validateFullStackArtifacts(
      request,
      files
    );

  errors.push(...fullStackErrors);

  checks.fullStackRequirements =
    fullStackErrors.length === 0;

  return {
    passed: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    checks
  };
}
