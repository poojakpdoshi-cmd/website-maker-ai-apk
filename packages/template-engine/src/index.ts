import type { GeneratedProject, GeneratedProjectFile, WebsitePlan } from '@wmai/shared';

export type ProjectBuildOptions = {
  formApiBase?: string;
  formPublicKey?: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}

function safeColour(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'website';
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'W';
}

function createLogoSvg(plan: WebsitePlan): string {
  const primary = safeColour(plan.theme.primary, '#6d5dfc');
  const secondary = safeColour(plan.theme.secondary, '#2bd4bd');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${escapeHtml(plan.businessName)} logo"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/></linearGradient></defs><rect width="512" height="512" rx="132" fill="url(#g)"/><text x="256" y="310" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="190" font-weight="900" fill="white">${escapeHtml(initials(plan.businessName))}</text></svg>`;
}

function createAppSource(plan: WebsitePlan, options: ProjectBuildOptions): string {
  const serialisedPlan = JSON.stringify(plan, null, 2).replace(/<\//g, '<\\/');
  const formUrl = options.formApiBase && options.formPublicKey
    ? `${options.formApiBase.replace(/\/$/, '')}/public/forms/${options.formPublicKey}/submit`
    : '';
  const serialisedFormUrl = JSON.stringify(formUrl);

  return `import { useState } from 'react';
import './styles.css';

const plan = ${serialisedPlan};
const FORM_URL = ${serialisedFormUrl};

function ContactForm() {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!FORM_URL) {
      setStatus('The contact form is not connected yet.');
      return;
    }
    setBusy(true);
    setStatus('');
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch(FORM_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not send your message.');
      event.currentTarget.reset();
      setStatus('Message sent successfully.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not send your message.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="contact-form" onSubmit={submit}>
    <div><label htmlFor="name">Name</label><input id="name" name="name" required maxLength="100" /></div>
    <div><label htmlFor="email">Email</label><input id="email" name="email" type="email" required maxLength="160" /></div>
    <div className="full"><label htmlFor="message">Message</label><textarea id="message" name="message" required maxLength="2000" rows="5" /></div>
    <button className="button" disabled={busy}>{busy ? 'Sending…' : 'Send enquiry'}</button>
    {status && <p className="form-status" role="status">{status}</p>}
  </form>;
}

function App() {
  const phone = (plan.contact?.phone || '').replace(/[^0-9]/g, '');
  const whatsappUrl = phone ? \`https://wa.me/\${phone}\` : '';
  const showForm = plan.features.includes('contact-form');

  return <>
    <nav className="nav">
      <a className="brand" href="#home"><img src="/logo.svg" alt="" />{plan.businessName}</a>
      <div className="nav-links">{plan.pages.map((page) => <a key={page} href={\`#\${page}\`}>{page.replace(/-/g, ' ')}</a>)}</div>
    </nav>

    <header className="hero" id="home">
      <div className="hero-copy">
        <span className="eyebrow">{plan.websiteType} · {plan.theme.style}</span>
        <h1>{plan.businessName}</h1>
        <p>{plan.tagline}</p>
        <div className="actions">
          <a className="button" href="#about">Explore website</a>
          {whatsappUrl && <a className="button secondary" href={whatsappUrl} target="_blank" rel="noreferrer">WhatsApp</a>}
        </div>
      </div>
      <div className="hero-card"><img src="/logo.svg" alt={\`\${plan.businessName} logo\`} /><strong>{plan.businessName}</strong><span>Made for mobile and desktop</span></div>
    </header>

    <main>
      {plan.sections.map((section, index) => {
        const id = plan.pages[index + 1] || \`section-\${index + 1}\`;
        return <section id={id} key={section.title} className="content-section"><span className="section-number">{String(index + 1).padStart(2, '0')}</span><div><p className="section-label">{id.replace(/-/g, ' ')}</p><h2>{section.title}</h2><p>{section.body}</p></div></section>;
      })}

      <section className="feature-panel" aria-label="Website features">
        <div><p className="section-label">Included</p><h2>Built to help the business grow</h2></div>
        <div className="chips">{plan.features.map((feature) => <span key={feature}>{feature.replace(/-/g, ' ')}</span>)}</div>
      </section>

      {showForm && <section id="contact" className="contact-section"><div><p className="section-label">Contact</p><h2>Start a conversation</h2><p>Send an enquiry and the business owner will receive it in Website Maker AI.</p></div><ContactForm /></section>}
    </main>

    <footer><div><strong>{plan.businessName}</strong><p>{plan.contact?.address || plan.tagline}</p></div><div>{plan.contact?.email && <a href={\`mailto:\${plan.contact.email}\`}>{plan.contact.email}</a>}{plan.contact?.phone && <a href={\`tel:\${plan.contact.phone}\`}>{plan.contact.phone}</a>}</div><small>Website generated by Website Maker AI · Made by Poojak Doshi</small></footer>
  </>;
}

export default App;
`;
}

function createStyles(plan: WebsitePlan): string {
  const primary = safeColour(plan.theme.primary, '#6d5dfc');
  const secondary = safeColour(plan.theme.secondary, '#2bd4bd');
  const background = safeColour(plan.theme.background, '#090b12');
  const text = safeColour(plan.theme.text, '#f7f8ff');
  return `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:${text};background:${background};font-synthesis:none;text-rendering:optimizeLegibility;--primary:${primary};--secondary:${secondary};--bg:${background};--text:${text}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-width:320px;background:radial-gradient(circle at 82% 0%,color-mix(in srgb,var(--primary) 28%,transparent),transparent 32%),var(--bg);color:var(--text)}a{color:inherit}.nav{position:sticky;top:0;z-index:20;display:flex;justify-content:space-between;align-items:center;gap:24px;padding:18px clamp(20px,6vw,88px);background:color-mix(in srgb,var(--bg) 84%,transparent);border-bottom:1px solid color-mix(in srgb,var(--text) 12%,transparent);backdrop-filter:blur(18px)}.brand{display:flex;align-items:center;gap:11px;text-decoration:none;font-weight:850}.brand img{width:38px;height:38px;border-radius:12px}.nav-links{display:flex;gap:19px;flex-wrap:wrap}.nav-links a{text-decoration:none;text-transform:capitalize;font-size:13px;opacity:.74}.hero{min-height:82vh;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr);align-items:center;gap:clamp(35px,8vw,120px);padding:90px clamp(20px,7vw,105px)}.eyebrow,.section-label{font-size:12px;font-weight:850;letter-spacing:.16em;text-transform:uppercase;color:var(--secondary)}h1{font-size:clamp(54px,10vw,128px);line-height:.9;letter-spacing:-.065em;margin:20px 0 26px;max-width:1050px}h2{font-size:clamp(34px,5.2vw,70px);line-height:1;margin:12px 0 20px;letter-spacing:-.045em}.hero-copy>p{font-size:clamp(18px,2vw,26px);line-height:1.62;max-width:720px;opacity:.76}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}.button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:999px;padding:15px 21px;background:var(--primary);color:white;text-decoration:none;font-weight:850;cursor:pointer}.button.secondary{background:transparent;border:1px solid color-mix(in srgb,var(--text) 24%,transparent);color:var(--text)}.hero-card{min-height:360px;border-radius:34px;padding:34px;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;background:linear-gradient(145deg,color-mix(in srgb,var(--primary) 30%,transparent),color-mix(in srgb,var(--secondary) 16%,transparent));border:1px solid color-mix(in srgb,var(--text) 15%,transparent);box-shadow:0 35px 95px rgba(0,0,0,.28)}.hero-card img{width:112px;height:112px;border-radius:30px;margin-bottom:auto}.hero-card strong{font-size:25px}.hero-card span{opacity:.68}main{padding:0 clamp(20px,7vw,105px) 90px}.content-section{scroll-margin-top:90px;display:grid;grid-template-columns:80px minmax(0,1fr);gap:25px;padding:75px 0;border-top:1px solid color-mix(in srgb,var(--text) 13%,transparent)}.content-section>div{max-width:850px}.content-section p:not(.section-label),.contact-section>div>p{font-size:18px;line-height:1.85;opacity:.72}.section-number{font-weight:900;color:var(--primary)}.feature-panel,.contact-section{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin:50px 0;padding:50px;border-radius:34px;background:color-mix(in srgb,var(--text) 5%,transparent);border:1px solid color-mix(in srgb,var(--text) 12%,transparent)}.chips{display:flex;gap:10px;align-content:center;flex-wrap:wrap}.chips span{padding:10px 14px;border-radius:999px;border:1px solid color-mix(in srgb,var(--text) 17%,transparent);text-transform:capitalize;font-size:13px}.contact-form{display:grid;grid-template-columns:1fr 1fr;gap:14px}.contact-form div{display:grid;gap:7px}.contact-form .full{grid-column:1/-1}.contact-form label{font-size:13px;opacity:.74}.contact-form input,.contact-form textarea{width:100%;padding:14px 15px;border-radius:15px;border:1px solid color-mix(in srgb,var(--text) 16%,transparent);background:color-mix(in srgb,var(--bg) 82%,black);color:var(--text);font:inherit}.contact-form .button{justify-self:start}.form-status{grid-column:1/-1;margin:0;font-size:14px}footer{display:grid;grid-template-columns:1fr auto;gap:25px;padding:50px clamp(20px,7vw,105px);border-top:1px solid color-mix(in srgb,var(--text) 13%,transparent)}footer p{opacity:.65}footer div:nth-child(2){display:grid;gap:8px;text-align:right}footer small{grid-column:1/-1;opacity:.5}@media(max-width:780px){.nav-links{display:none}.hero{grid-template-columns:1fr;min-height:auto;padding-top:70px}.hero-card{min-height:260px}.content-section{grid-template-columns:1fr}.feature-panel,.contact-section{grid-template-columns:1fr;padding:28px}.contact-form{grid-template-columns:1fr}.contact-form .full{grid-column:auto}footer{grid-template-columns:1fr}footer div:nth-child(2){text-align:left}h1{font-size:clamp(52px,17vw,88px)}}`;
}

export function buildProjectFiles(plan: WebsitePlan, options: ProjectBuildOptions = {}): GeneratedProject {
  const projectName = slugify(plan.businessName);
  const files: GeneratedProjectFile[] = [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: projectName,
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { '@vitejs/plugin-react': '^4.6.0', vite: '^7.0.4', react: '^19.1.0', 'react-dom': '^19.1.0' },
        devDependencies: {}
      }, null, 2)
    },
    { path: 'index.html', content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><meta name="description" content="${escapeHtml(plan.tagline)}"/><meta property="og:title" content="${escapeHtml(plan.businessName)}"/><meta property="og:description" content="${escapeHtml(plan.tagline)}"/><link rel="icon" href="/logo.svg"/><title>${escapeHtml(plan.businessName)}</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>` },
    { path: 'src/main.jsx', content: `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App.jsx';\n\nReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);\n` },
    { path: 'src/App.jsx', content: createAppSource(plan, options) },
    { path: 'src/styles.css', content: createStyles(plan) },
    { path: 'public/logo.svg', content: createLogoSvg(plan) },
    { path: 'vite.config.js', content: `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n` },
    { path: 'vercel.json', content: JSON.stringify({ framework: 'vite', buildCommand: 'npm run build', outputDirectory: 'dist' }, null, 2) },
    { path: 'README.md', content: `# ${plan.businessName}\n\nGenerated by Website Maker AI.\n\n## Run\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n` }
  ];
  return { files, previewHtml: renderPreviewHtml(plan, options), framework: 'vite-react' };
}

export function renderPreviewHtml(plan: WebsitePlan, options: ProjectBuildOptions = {}): string {
  const primary = safeColour(plan.theme.primary, '#6d5dfc');
  const secondary = safeColour(plan.theme.secondary, '#2bd4bd');
  const background = safeColour(plan.theme.background, '#090b12');
  const text = safeColour(plan.theme.text, '#f7f8ff');
  const phone = plan.contact?.phone?.replace(/[^0-9]/g, '') || '';
  const formUrl = options.formApiBase && options.formPublicKey ? `${options.formApiBase.replace(/\/$/, '')}/public/forms/${options.formPublicKey}/submit` : '';
  const sections = plan.sections.map((section, index) => `<section id="${escapeHtml(plan.pages[index + 1] || `section-${index + 1}`)}"><small>${String(index + 1).padStart(2, '0')}</small><div><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p></div></section>`).join('');
  const form = plan.features.includes('contact-form') ? `<section id="contact"><small>CONTACT</small><div><h2>Start a conversation</h2><form id="contact-form"><input name="name" placeholder="Name" required><input name="email" type="email" placeholder="Email" required><textarea name="message" placeholder="Message" required></textarea><button>Send enquiry</button><p id="form-status"></p></form></div></section>` : '';
  const script = formUrl ? `<script>document.getElementById('contact-form')?.addEventListener('submit',async(e)=>{e.preventDefault();const s=document.getElementById('form-status');s.textContent='Sending…';try{const r=await fetch(${JSON.stringify(formUrl)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not send');e.target.reset();s.textContent='Message sent successfully.'}catch(err){s.textContent=err.message||'Could not send'}})</script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(plan.businessName)}</title><meta name="description" content="${escapeHtml(plan.tagline)}"><style>*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,Arial,sans-serif;background:${background};color:${text}}nav{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;padding:18px 6vw;background:${background}e8;border-bottom:1px solid ${text}22}nav a{color:inherit;text-decoration:none}.hero{min-height:76vh;padding:80px 7vw;display:grid;place-items:center;background:radial-gradient(circle at 80% 10%,${primary}55,transparent 36%)}.hero>div{max-width:1000px}.eyebrow{color:${secondary};font-weight:900;letter-spacing:.14em}h1{font-size:clamp(52px,11vw,120px);line-height:.9;letter-spacing:-.06em;margin:20px 0}.hero p{font-size:clamp(18px,2vw,25px);line-height:1.65;max-width:720px;opacity:.76}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}.button,button{display:inline-block;padding:14px 19px;border:0;border-radius:999px;background:${primary};color:white;text-decoration:none;font-weight:800}main{padding:30px 7vw 80px}section{display:grid;grid-template-columns:80px 1fr;gap:24px;padding:58px 0;border-bottom:1px solid ${text}22}section small{color:${secondary};font-weight:900}h2{font-size:clamp(32px,5vw,62px);margin:0 0 16px}section p{font-size:18px;line-height:1.8;opacity:.72;max-width:780px}form{display:grid;gap:11px;max-width:680px}input,textarea{padding:14px;border-radius:14px;border:1px solid ${text}33;background:${background};color:${text};font:inherit}footer{padding:35px 7vw;opacity:.65}@media(max-width:650px){section{grid-template-columns:1fr}h1{font-size:54px}}</style></head><body><nav><strong>${escapeHtml(plan.businessName)}</strong><a href="#contact">Contact</a></nav><header class="hero" id="home"><div><span class="eyebrow">${escapeHtml(plan.websiteType.toUpperCase())} · ${escapeHtml(plan.theme.style.toUpperCase())}</span><h1>${escapeHtml(plan.businessName)}</h1><p>${escapeHtml(plan.tagline)}</p><div class="actions"><a class="button" href="#${escapeHtml(plan.pages[1] || 'about')}">Explore</a>${phone ? `<a class="button" href="https://wa.me/${phone}" target="_blank">WhatsApp</a>` : ''}</div></div></header><main>${sections}${form}</main><footer>© ${new Date().getFullYear()} ${escapeHtml(plan.businessName)} · Made by Poojak Doshi</footer>${script}</body></html>`;
}

export function projectSlug(plan: WebsitePlan): string {
  return slugify(plan.businessName);
}
