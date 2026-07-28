import { buildWebsitePlan, reviseWebsitePlan } from '@wmai/ai-brain';
import { buildProjectFiles } from '@wmai/template-engine';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const { plan, mode } = await buildWebsitePlan(
    'Create a premium modern website for a jewellery shop called Test Jewels with products, WhatsApp +919876543210, gallery, contact form and SEO.',
    {}
  );
  assert(mode === 'built-in', 'Expected the zero-cost built-in brain without an API key.');
  assert(plan.businessName === 'Test Jewels', `Business name parsing failed: ${plan.businessName}`);
  assert(plan.pages.includes('collections'), 'Collections page was not selected.');
  assert(plan.features.includes('contact-form'), 'Contact form was not selected.');

  const generated = buildProjectFiles(plan, { formApiBase: 'https://api.example.com', formPublicKey: 'test-form-key' });
  const paths = new Set(generated.files.map((file) => file.path));
  for (const required of ['package.json', 'index.html', 'src/main.jsx', 'src/App.jsx', 'src/styles.css', 'public/logo.svg', 'vite.config.js', 'vercel.json']) {
    assert(paths.has(required), `Generated project is missing ${required}.`);
  }
  assert(generated.previewHtml.includes('Test Jewels'), 'Preview does not contain the business name.');
  assert(generated.previewHtml.includes('contact-form'), 'Preview does not contain the contact form.');

  const revised = await reviseWebsitePlan(plan, 'Change to a light blue theme and add pricing.', {});
  assert(revised.plan.pages.includes('pricing'), 'Built-in editor did not add pricing.');
  assert(revised.plan.theme.background === '#f8fafc', 'Built-in editor did not switch to a light theme.');

  console.log(JSON.stringify({
    ok: true,
    mode,
    businessName: plan.businessName,
    framework: generated.framework,
    fileCount: generated.files.length,
    previewBytes: generated.previewHtml.length,
    editorWorks: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
