import type { GeneratedProject, GeneratedProjectFile, WebsitePlan } from '../../shared/src/index';

export type ProjectBuildOptions = {
  formApiBase?: string;
  formPublicKey?: string;
};

type DesignProfile = {
  key: 'luxury' | 'editorial' | 'glass' | 'commerce' | 'tech' | 'playful' | 'corporate' | 'organic';
  label: string;
  heroImage: string;
  displayFont: string;
  bodyFont: string;
  radius: number;
  maxWidth: number;
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
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'N';
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = safeColour(hex, '#111827').slice(1);
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16)
  };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function titleCase(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function chooseHeroImage(source: string): string {
  const value = source.toLowerCase();
  const images: Array<[RegExp, string]> = [
    [/jewel|diamond|gold|luxury|fashion|boutique|saree|lehenga/, 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1600&q=88'],
    [/restaurant|cafe|food|bakery|hotel/, 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=88'],
    [/real estate|property|architect|interior|home/, 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1600&q=88'],
    [/school|education|tuition|academy|course|learning/, 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1600&q=88'],
    [/fitness|gym|sports|health|wellness/, 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1600&q=88'],
    [/technology|software|startup|ai|cyber|digital|agency/, 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1600&q=88'],
    [/travel|tour|resort|adventure/, 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=88'],
    [/beauty|salon|spa|skincare/, 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1600&q=88']
  ];
  return images.find(([pattern]) => pattern.test(value))?.[1]
    || 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1600&q=88';
}

function chooseProfile(plan: WebsitePlan): DesignProfile {
  const source = `${plan.businessName} ${plan.websiteType} ${plan.theme.style} ${plan.features.join(' ')}`.toLowerCase();
  let key: DesignProfile['key'];

  if (/luxury|premium|jewel|fashion|boutique|wedding|hotel/.test(source)) key = 'luxury';
  else if (/magazine|portfolio|artist|photography|editorial|studio/.test(source)) key = 'editorial';
  else if (/glass|futur|neon|cyber|gaming|space/.test(source)) key = 'glass';
  else if (/shop|store|commerce|product|retail|market/.test(source)) key = 'commerce';
  else if (/ai|software|technology|startup|saas|digital/.test(source)) key = 'tech';
  else if (/kids|creative|fun|event|festival|toy/.test(source)) key = 'playful';
  else if (/organic|wellness|nature|eco|yoga|spa/.test(source)) key = 'organic';
  else key = 'corporate';

  const profiles: Record<DesignProfile['key'], Omit<DesignProfile, 'key' | 'heroImage'>> = {
    luxury: { label: 'Refined luxury', displayFont: 'Georgia, "Times New Roman", serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 8, maxWidth: 1380 },
    editorial: { label: 'Editorial direction', displayFont: '"Arial Black", Impact, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 2, maxWidth: 1460 },
    glass: { label: 'Immersive digital', displayFont: 'Inter, ui-sans-serif, system-ui, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 30, maxWidth: 1320 },
    commerce: { label: 'Conversion focused', displayFont: 'Inter, ui-sans-serif, system-ui, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 18, maxWidth: 1400 },
    tech: { label: 'Product led', displayFont: 'Inter, ui-sans-serif, system-ui, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 22, maxWidth: 1360 },
    playful: { label: 'Bold and expressive', displayFont: '"Trebuchet MS", Inter, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 34, maxWidth: 1320 },
    corporate: { label: 'Clear and credible', displayFont: 'Inter, ui-sans-serif, system-ui, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 14, maxWidth: 1320 },
    organic: { label: 'Warm and natural', displayFont: 'Georgia, "Times New Roman", serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 28, maxWidth: 1280 }
  };

  return { key, heroImage: chooseHeroImage(source), ...profiles[key] };
}

function createLogoSvg(plan: WebsitePlan): string {
  const primary = safeColour(plan.theme.primary, '#6d5dfc');
  const secondary = safeColour(plan.theme.secondary, '#2bd4bd');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${escapeHtml(plan.businessName)} logo"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/></linearGradient></defs><rect width="512" height="512" rx="132" fill="url(#g)"/><circle cx="256" cy="256" r="174" fill="none" stroke="white" stroke-opacity=".22" stroke-width="10"/><text x="256" y="310" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="176" font-weight="900" fill="white">${escapeHtml(initials(plan.businessName))}</text></svg>`;
}

function createAppSource(plan: WebsitePlan, options: ProjectBuildOptions, profile: DesignProfile): string {
  const serialisedPlan = JSON.stringify(plan, null, 2).replace(/<\//g, '<\\/');
  const serialisedProfile = JSON.stringify(profile, null, 2).replace(/<\//g, '<\\/');
  const formUrl = options.formApiBase && options.formPublicKey
    ? `${options.formApiBase.replace(/\/$/, '')}/public/forms/${options.formPublicKey}/submit`
    : '';

  return `import { useState } from 'react';
import './styles.css';

const plan = ${serialisedPlan};
const design = ${serialisedProfile};
const FORM_URL = ${JSON.stringify(formUrl)};

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

function ContactForm() {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!FORM_URL) {
      setStatus('The contact form is ready to connect.');
      return;
    }
    setBusy(true);
    setStatus('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(FORM_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(form.entries()))
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
    <div><label htmlFor="name">Name</label><input id="name" name="name" required maxLength="100" placeholder="Your name" /></div>
    <div><label htmlFor="email">Email</label><input id="email" name="email" type="email" required maxLength="160" placeholder="you@example.com" /></div>
    <div className="full"><label htmlFor="message">Message</label><textarea id="message" name="message" required maxLength="2000" rows="5" placeholder="Tell us what you need" /></div>
    <button className="button" disabled={busy}>{busy ? 'Sending…' : 'Send enquiry'}</button>
    {status && <p className="form-status" role="status">{status}</p>}
  </form>;
}

function App() {
  const phone = (plan.contact?.phone || '').replace(/[^0-9]/g, '');
  const whatsappUrl = phone ? 'https://wa.me/' + phone : '';
  const showForm = plan.features.includes('contact-form');
  const visiblePages = plan.pages.slice(0, 5);
  const featureItems = plan.features.length ? plan.features : ['responsive-design', 'fast-loading', 'clear-navigation'];
  const metricSeed = plan.businessName.length + plan.sections.length + plan.features.length;

  return <div className={'site profile-' + design.key}>
    <nav className="nav">
      <a className="brand" href="#home"><img src="/logo.svg" alt="" /><span>{plan.businessName}</span></a>
      <div className="nav-links">{visiblePages.map((page) => <a key={page} href={'#' + slug(page)}>{String(page).replace(/-/g, ' ')}</a>)}</div>
      <a className="nav-cta" href="#contact">Let&apos;s talk</a>
    </nav>

    <header className="hero" id="home">
      <div className="hero-copy">
        <span className="eyebrow">{design.label} · {plan.websiteType}</span>
        <h1>{plan.businessName}</h1>
        <p className="hero-tagline">{plan.tagline}</p>
        <div className="actions">
          <a className="button" href={'#' + slug(plan.pages[1] || 'about')}>Explore the experience</a>
          {whatsappUrl && <a className="button secondary" href={whatsappUrl} target="_blank" rel="noreferrer">WhatsApp</a>}
        </div>
        <div className="mini-proof"><span>Responsive</span><span>Purpose-built</span><span>Premium finish</span></div>
      </div>

      <div className="hero-visual" style={{ backgroundImage: 'linear-gradient(180deg, rgba(5,8,18,.04), rgba(5,8,18,.64)), url("' + design.heroImage + '")' }}>
        <div className="visual-badge"><small>Designed for</small><strong>{plan.websiteType}</strong></div>
        <div className="visual-card"><span>01</span><p>{plan.sections[0]?.title || 'A memorable first impression'}</p></div>
      </div>
    </header>

    <section className="metric-strip" aria-label="Highlights">
      <article><strong>{String(90 + (metricSeed % 9))}%</strong><span>Mobile-ready experience</span></article>
      <article><strong>{String(Math.max(3, plan.sections.length)).padStart(2, '0')}</strong><span>Purposeful sections</span></article>
      <article><strong>{String(Math.max(4, featureItems.length)).padStart(2, '0')}</strong><span>Business features</span></article>
    </section>

    <main>
      {plan.sections.map((section, index) => {
        const id = slug(plan.pages[index + 1] || section.title || 'section-' + (index + 1));
        const layout = ['split', 'spotlight', 'cards'][index % 3];
        return <section id={id} key={section.title + index} className={'content-section layout-' + layout}>
          <div className="section-kicker"><span>{String(index + 1).padStart(2, '0')}</span><small>{String(plan.pages[index + 1] || 'Discover').replace(/-/g, ' ')}</small></div>
          <div className="section-copy"><h2>{section.title}</h2><p>{section.body}</p></div>
          <div className="section-detail" aria-hidden="true"><span>{plan.businessName}</span><strong>{String(index + 1).padStart(2, '0')}</strong></div>
        </section>;
      })}

      <section className="feature-panel">
        <div className="feature-heading"><span className="eyebrow">Built with intention</span><h2>Everything needed to turn attention into action.</h2><p>A focused experience with useful features, clear hierarchy and a visual direction matched to the business.</p></div>
        <div className="feature-grid">{featureItems.map((feature, index) => <article key={feature}><span>{String(index + 1).padStart(2, '0')}</span><h3>{String(feature).replace(/-/g, ' ')}</h3><p>Designed as a polished, responsive part of the complete customer journey.</p></article>)}</div>
      </section>

      {showForm && <section id="contact" className="contact-section">
        <div><span className="eyebrow">Start a conversation</span><h2>Ready to move forward?</h2><p>{plan.contact?.address || 'Share your requirement and the team will get back to you.'}</p></div>
        <ContactForm />
      </section>}
    </main>

    <footer>
      <div><a className="brand" href="#home"><img src="/logo.svg" alt="" /><span>{plan.businessName}</span></a><p>{plan.tagline}</p></div>
      <div className="footer-links">{plan.contact?.email && <a href={'mailto:' + plan.contact.email}>{plan.contact.email}</a>}{plan.contact?.phone && <a href={'tel:' + plan.contact.phone}>{plan.contact.phone}</a>}</div>
      <small>© {new Date().getFullYear()} {plan.businessName} · Made by Poojak Doshi</small>
    </footer>
  </div>;
}

export default App;
`;
}

function createStyles(plan: WebsitePlan, profile: DesignProfile): string {
  const primary = safeColour(plan.theme.primary, '#6d5dfc');
  const secondary = safeColour(plan.theme.secondary, '#2bd4bd');
  const background = safeColour(plan.theme.background, '#090b12');
  const text = safeColour(plan.theme.text, '#f7f8ff');
  const primarySoft = rgba(primary, .18);
  const secondarySoft = rgba(secondary, .16);
  const textSoft = rgba(text, .66);
  const textFaint = rgba(text, .12);
  const surface = rgba(text, .055);
  const surfaceStrong = rgba(text, .09);
  const radius = `${profile.radius}px`;
  const radiusLarge = `${Math.max(24, profile.radius * 2)}px`;

  return `:root{font-family:${profile.bodyFont};color:${text};background:${background};font-synthesis:none;text-rendering:optimizeLegibility;--primary:${primary};--secondary:${secondary};--bg:${background};--text:${text};--text-soft:${textSoft};--line:${textFaint};--surface:${surface};--surface-strong:${surfaceStrong};--primary-soft:${primarySoft};--secondary-soft:${secondarySoft};--radius:${radius};--radius-lg:${radiusLarge};--max:${profile.maxWidth}px;--display:${profile.displayFont}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-width:320px;background:radial-gradient(circle at 86% -8%,var(--primary-soft),transparent 31%),radial-gradient(circle at 6% 36%,var(--secondary-soft),transparent 26%),var(--bg);color:var(--text)}body:before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:54px 54px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.25),transparent 58%);opacity:.15}a{color:inherit}.site{position:relative;overflow:hidden}.nav{position:sticky;top:0;z-index:40;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:24px;padding:16px max(20px,calc((100vw - var(--max))/2));background:${rgba(background, .84)};border-bottom:1px solid var(--line);backdrop-filter:blur(22px)}.brand{display:inline-flex;align-items:center;gap:11px;text-decoration:none;font-weight:850;letter-spacing:-.02em}.brand img{width:39px;height:39px;border-radius:13px}.nav-links{display:flex;gap:22px}.nav-links a{text-decoration:none;text-transform:capitalize;font-size:13px;color:var(--text-soft);transition:.2s ease}.nav-links a:hover{color:var(--text)}.nav-cta{justify-self:end;text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:11px 16px;font-size:13px;font-weight:800}.hero{width:min(calc(100% - 40px),var(--max));min-height:calc(100vh - 72px);margin:auto;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(340px,.95fr);align-items:center;gap:clamp(34px,6vw,95px);padding:70px 0}.hero-copy{position:relative;z-index:2}.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:var(--secondary)}.eyebrow:before{content:"";width:28px;height:1px;background:currentColor}h1,h2{font-family:var(--display)}h1{font-size:clamp(58px,8.8vw,132px);line-height:.88;letter-spacing:-.065em;margin:22px 0 27px;max-width:920px}.hero-tagline{font-size:clamp(18px,2vw,25px);line-height:1.65;max-width:700px;color:var(--text-soft)}.actions{display:flex;gap:11px;flex-wrap:wrap;margin-top:30px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:50px;border:0;border-radius:999px;padding:14px 21px;background:var(--primary);color:white;text-decoration:none;font-weight:850;box-shadow:0 18px 45px ${rgba(primary, .22)};cursor:pointer}.button.secondary{background:transparent;border:1px solid var(--line);box-shadow:none;color:var(--text)}.mini-proof{display:flex;gap:20px;flex-wrap:wrap;margin-top:35px;color:var(--text-soft);font-size:12px}.mini-proof span:before{content:"✦";margin-right:7px;color:var(--secondary)}.hero-visual{position:relative;min-height:620px;border-radius:var(--radius-lg);background-size:cover;background-position:center;overflow:hidden;border:1px solid var(--line);box-shadow:0 42px 100px rgba(0,0,0,.34);transform:rotate(1.2deg)}.hero-visual:after{content:"";position:absolute;inset:0;background:linear-gradient(135deg,transparent 45%,${rgba(primary, .34)})}.visual-badge,.visual-card{position:absolute;z-index:2;background:${rgba(background, .72)};border:1px solid ${rgba(text, .18)};backdrop-filter:blur(18px)}.visual-badge{top:24px;left:24px;padding:15px 17px;border-radius:999px;display:flex;gap:9px;align-items:center}.visual-badge small{color:var(--text-soft)}.visual-card{right:24px;bottom:24px;width:min(300px,calc(100% - 48px));padding:23px;border-radius:var(--radius)}.visual-card span{font-size:11px;color:var(--secondary);font-weight:900}.visual-card p{font-family:var(--display);font-size:24px;line-height:1.12;margin:15px 0 0}.metric-strip{width:min(calc(100% - 40px),var(--max));margin:0 auto 90px;display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);border-radius:var(--radius-lg);overflow:hidden;background:var(--surface)}.metric-strip article{padding:26px 30px;display:grid;gap:6px}.metric-strip article+article{border-left:1px solid var(--line)}.metric-strip strong{font-family:var(--display);font-size:36px}.metric-strip span{font-size:12px;color:var(--text-soft)}main{width:min(calc(100% - 40px),var(--max));margin:auto;padding-bottom:100px}.content-section{scroll-margin-top:90px;position:relative;display:grid;grid-template-columns:120px minmax(0,1fr) 220px;gap:clamp(24px,5vw,78px);align-items:start;padding:100px 0;border-top:1px solid var(--line)}.section-kicker{display:grid;gap:8px}.section-kicker span{font-family:var(--display);font-size:36px;color:var(--primary)}.section-kicker small{text-transform:capitalize;color:var(--text-soft)}.section-copy{max-width:820px}.section-copy h2,.feature-heading h2,.contact-section h2{font-size:clamp(38px,5.5vw,76px);line-height:.98;letter-spacing:-.045em;margin:0 0 24px}.section-copy p,.feature-heading p,.contact-section>div>p{font-size:18px;line-height:1.85;color:var(--text-soft);margin:0}.section-detail{min-height:180px;border-radius:var(--radius);padding:20px;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(145deg,var(--primary-soft),var(--secondary-soft));border:1px solid var(--line);overflow:hidden}.section-detail span{font-size:12px;color:var(--text-soft)}.section-detail strong{font-family:var(--display);font-size:78px;line-height:.8;align-self:flex-end;opacity:.38}.layout-spotlight{grid-template-columns:220px minmax(0,1fr) 120px}.layout-spotlight .section-kicker{order:3}.layout-spotlight .section-detail{order:1}.layout-spotlight .section-copy{order:2}.layout-cards .section-detail{background:var(--surface-strong)}.feature-panel{display:grid;grid-template-columns:.8fr 1.2fr;gap:55px;margin:50px 0 100px;padding:clamp(28px,5vw,65px);border-radius:var(--radius-lg);background:linear-gradient(145deg,var(--surface-strong),var(--surface));border:1px solid var(--line)}.feature-heading h2{font-size:clamp(42px,5vw,68px);margin-top:18px}.feature-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.feature-grid article{min-height:190px;padding:23px;border:1px solid var(--line);border-radius:var(--radius);background:${rgba(background, .46)}}.feature-grid article span{color:var(--secondary);font-size:11px;font-weight:900}.feature-grid h3{text-transform:capitalize;font-size:20px;margin:32px 0 10px}.feature-grid p{font-size:14px;line-height:1.65;color:var(--text-soft)}.contact-section{display:grid;grid-template-columns:.8fr 1.2fr;gap:55px;margin:70px 0;padding:clamp(28px,5vw,65px);border-radius:var(--radius-lg);background:var(--primary);color:white}.contact-section .eyebrow,.contact-section>div>p{color:rgba(255,255,255,.76)}.contact-form{display:grid;grid-template-columns:1fr 1fr;gap:13px}.contact-form div{display:grid;gap:7px}.contact-form .full{grid-column:1/-1}.contact-form label{font-size:12px;color:rgba(255,255,255,.75)}.contact-form input,.contact-form textarea{width:100%;padding:14px 15px;border-radius:calc(var(--radius) * .7);border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.12);color:white;font:inherit;outline:none}.contact-form input::placeholder,.contact-form textarea::placeholder{color:rgba(255,255,255,.58)}.contact-form .button{justify-self:start;background:white;color:#111827;box-shadow:none}.form-status{grid-column:1/-1;margin:0;font-size:13px}footer{width:min(calc(100% - 40px),var(--max));margin:auto;display:grid;grid-template-columns:1fr auto;gap:26px;padding:50px 0;border-top:1px solid var(--line)}footer p{color:var(--text-soft);max-width:520px}.footer-links{display:grid;gap:8px;text-align:right}.footer-links a{text-decoration:none;color:var(--text-soft)}footer small{grid-column:1/-1;color:var(--text-soft)}.profile-luxury h1{text-transform:uppercase;font-weight:500;letter-spacing:-.045em}.profile-luxury .hero-visual{border-radius:180px 180px 16px 16px}.profile-editorial .hero{grid-template-columns:1.25fr .75fr}.profile-editorial h1{text-transform:uppercase}.profile-editorial .hero-visual{min-height:700px;filter:saturate(.72)}.profile-glass .hero-visual,.profile-glass .feature-panel{box-shadow:inset 0 1px rgba(255,255,255,.18),0 42px 100px rgba(0,0,0,.32)}.profile-commerce .hero-visual{border-radius:24px}.profile-commerce .button{border-radius:12px}.profile-playful .hero-visual{transform:rotate(-2deg)}.profile-organic .hero-visual{border-radius:48% 48% 24px 24px}@media(max-width:920px){.nav{grid-template-columns:1fr auto}.nav-links{display:none}.hero{grid-template-columns:1fr;min-height:auto;padding-top:55px}.hero-visual{min-height:520px;transform:none}.content-section,.layout-spotlight{grid-template-columns:90px minmax(0,1fr)}.section-detail,.layout-spotlight .section-detail{display:none}.layout-spotlight .section-kicker{order:initial}.layout-spotlight .section-copy{order:initial}.feature-panel,.contact-section{grid-template-columns:1fr}}@media(max-width:650px){.nav{padding:12px 18px}.nav-cta{display:none}.hero,main,.metric-strip,footer{width:min(calc(100% - 28px),var(--max))}.hero{padding:45px 0}.hero-visual{min-height:430px}.visual-badge{top:14px;left:14px}.visual-card{right:14px;bottom:14px;width:calc(100% - 28px)}h1{font-size:clamp(54px,17vw,82px)}.metric-strip{grid-template-columns:1fr}.metric-strip article+article{border-left:0;border-top:1px solid var(--line)}.content-section,.layout-spotlight{grid-template-columns:1fr;padding:72px 0}.section-kicker{display:flex;align-items:center;gap:12px}.section-kicker span{font-size:25px}.feature-grid{grid-template-columns:1fr}.contact-form{grid-template-columns:1fr}.contact-form .full{grid-column:auto}footer{grid-template-columns:1fr}.footer-links{text-align:left}}`;
}

function createPreviewHtml(plan: WebsitePlan, options: ProjectBuildOptions, profile: DesignProfile): string {
  const styles = createStyles(plan, profile);
  const phone = plan.contact?.phone?.replace(/[^0-9]/g, '') || '';
  const formUrl = options.formApiBase && options.formPublicKey
    ? `${options.formApiBase.replace(/\/$/, '')}/public/forms/${options.formPublicKey}/submit`
    : '';
  const visiblePages = plan.pages.slice(0, 5);
  const features = plan.features.length ? plan.features : ['responsive-design', 'fast-loading', 'clear-navigation'];
  const metricSeed = plan.businessName.length + plan.sections.length + plan.features.length;
  const sections = plan.sections.map((section, index) => {
    const id = slugify(plan.pages[index + 1] || section.title || `section-${index + 1}`);
    const layout = ['split', 'spotlight', 'cards'][index % 3];
    return `<section id="${escapeHtml(id)}" class="content-section layout-${layout}"><div class="section-kicker"><span>${String(index + 1).padStart(2, '0')}</span><small>${escapeHtml(titleCase(plan.pages[index + 1] || 'Discover'))}</small></div><div class="section-copy"><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p></div><div class="section-detail" aria-hidden="true"><span>${escapeHtml(plan.businessName)}</span><strong>${String(index + 1).padStart(2, '0')}</strong></div></section>`;
  }).join('');
  const featureCards = features.map((feature, index) => `<article><span>${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(titleCase(feature))}</h3><p>Designed as a polished, responsive part of the complete customer journey.</p></article>`).join('');
  const form = plan.features.includes('contact-form')
    ? `<section id="contact" class="contact-section"><div><span class="eyebrow">Start a conversation</span><h2>Ready to move forward?</h2><p>${escapeHtml(plan.contact?.address || 'Share your requirement and the team will get back to you.')}</p></div><form class="contact-form" id="contact-form"><div><label>Name</label><input name="name" placeholder="Your name" required></div><div><label>Email</label><input name="email" type="email" placeholder="you@example.com" required></div><div class="full"><label>Message</label><textarea name="message" placeholder="Tell us what you need" required></textarea></div><button class="button">Send enquiry</button><p class="form-status" id="form-status"></p></form></section>`
    : '';
  const script = formUrl
    ? `<script>document.getElementById('contact-form')?.addEventListener('submit',async(e)=>{e.preventDefault();const s=document.getElementById('form-status');s.textContent='Sending…';try{const r=await fetch(${JSON.stringify(formUrl)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not send');e.target.reset();s.textContent='Message sent successfully.'}catch(err){s.textContent=err.message||'Could not send'}})</script>`
    : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(plan.businessName)}</title><meta name="description" content="${escapeHtml(plan.tagline)}"><style>${styles}</style></head><body><div class="site profile-${profile.key}"><nav class="nav"><a class="brand" href="#home"><img src="data:image/svg+xml,${encodeURIComponent(createLogoSvg(plan))}" alt=""><span>${escapeHtml(plan.businessName)}</span></a><div class="nav-links">${visiblePages.map((page) => `<a href="#${escapeHtml(slugify(page))}">${escapeHtml(titleCase(page))}</a>`).join('')}</div><a class="nav-cta" href="#contact">Let's talk</a></nav><header class="hero" id="home"><div class="hero-copy"><span class="eyebrow">${escapeHtml(profile.label)} · ${escapeHtml(plan.websiteType)}</span><h1>${escapeHtml(plan.businessName)}</h1><p class="hero-tagline">${escapeHtml(plan.tagline)}</p><div class="actions"><a class="button" href="#${escapeHtml(slugify(plan.pages[1] || 'about'))}">Explore the experience</a>${phone ? `<a class="button secondary" href="https://wa.me/${phone}" target="_blank">WhatsApp</a>` : ''}</div><div class="mini-proof"><span>Responsive</span><span>Purpose-built</span><span>Premium finish</span></div></div><div class="hero-visual" style="background-image:linear-gradient(180deg,rgba(5,8,18,.04),rgba(5,8,18,.64)),url('${escapeHtml(profile.heroImage)}')"><div class="visual-badge"><small>Designed for</small><strong>${escapeHtml(plan.websiteType)}</strong></div><div class="visual-card"><span>01</span><p>${escapeHtml(plan.sections[0]?.title || 'A memorable first impression')}</p></div></div></header><section class="metric-strip"><article><strong>${90 + (metricSeed % 9)}%</strong><span>Mobile-ready experience</span></article><article><strong>${String(Math.max(3, plan.sections.length)).padStart(2, '0')}</strong><span>Purposeful sections</span></article><article><strong>${String(Math.max(4, features.length)).padStart(2, '0')}</strong><span>Business features</span></article></section><main>${sections}<section class="feature-panel"><div class="feature-heading"><span class="eyebrow">Built with intention</span><h2>Everything needed to turn attention into action.</h2><p>A focused experience with useful features, clear hierarchy and a visual direction matched to the business.</p></div><div class="feature-grid">${featureCards}</div></section>${form}</main><footer><div><strong>${escapeHtml(plan.businessName)}</strong><p>${escapeHtml(plan.tagline)}</p></div><div class="footer-links">${plan.contact?.email ? `<a href="mailto:${escapeHtml(plan.contact.email)}">${escapeHtml(plan.contact.email)}</a>` : ''}${plan.contact?.phone ? `<a href="tel:${escapeHtml(plan.contact.phone)}">${escapeHtml(plan.contact.phone)}</a>` : ''}</div><small>© ${new Date().getFullYear()} ${escapeHtml(plan.businessName)} · Made by Poojak Doshi</small></footer></div>${script}</body></html>`;
}

export function buildProjectFiles(plan: WebsitePlan, options: ProjectBuildOptions = {}): GeneratedProject {
  const projectName = slugify(plan.businessName);
  const profile = chooseProfile(plan);
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
    { path: 'src/App.jsx', content: createAppSource(plan, options, profile) },
    { path: 'src/styles.css', content: createStyles(plan, profile) },
    { path: 'public/logo.svg', content: createLogoSvg(plan) },
    { path: 'vite.config.js', content: `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n` },
    { path: 'vercel.json', content: JSON.stringify({ framework: 'vite', buildCommand: 'npm run build', outputDirectory: 'dist' }, null, 2) },
    { path: 'README.md', content: `# ${plan.businessName}\n\nGenerated by Nexora AI.\n\n## Run\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n` }
  ];
  return { files, previewHtml: createPreviewHtml(plan, options, profile), framework: 'vite-react' };
}

export function renderPreviewHtml(plan: WebsitePlan, options: ProjectBuildOptions = {}): string {
  return createPreviewHtml(plan, options, chooseProfile(plan));
}

export function projectSlug(plan: WebsitePlan): string {
  return slugify(plan.businessName);
}
