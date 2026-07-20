import type { GeneratedProject, GeneratedProjectFile, WebsitePlan } from '../../shared/src/index';

export type ProjectBuildOptions = {
  formApiBase?: string;
  formPublicKey?: string;
};

type DesignProfile = {
  key: 'aurora' | 'orbital' | 'editorial' | 'monolith' | 'glass' | 'commerce' | 'playful' | 'organic';
  label: string;
  displayFont: string;
  bodyFont: string;
  radius: number;
  maxWidth: number;
  density: 'airy' | 'balanced' | 'dense';
  seed: number;
};

function escapeHtml(value: string): string {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}

function safeColour(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function slugify(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'website';
}

function titleCase(value: string): string {
  return String(value || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function initials(value: string): string {
  return String(value || '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'N';
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

function ensurePages(plan: WebsitePlan): string[] {
  const requested = Array.isArray(plan.pages) ? plan.pages.map(slugify).filter(Boolean) : [];
  const pages = ['home', ...requested.filter((page) => page !== 'home')];
  const source = `${plan.websiteType} ${plan.features.join(' ')} ${plan.sections.map((section) => section.title).join(' ')}`.toLowerCase();
  const candidates = /saas|software|technology|ai|startup/.test(source)
    ? ['product', 'solutions', 'templates', 'pricing', 'about', 'contact']
    : /shop|store|commerce|product/.test(source)
      ? ['shop', 'collections', 'why-us', 'reviews', 'about', 'contact']
      : ['services', 'process', 'results', 'about', 'faq', 'contact'];
  for (const candidate of candidates) {
    if (!pages.includes(candidate) && pages.length < 8) pages.push(candidate);
  }
  if (!pages.includes('contact')) pages.push('contact');
  return pages.slice(0, 8);
}

function chooseProfile(plan: WebsitePlan): DesignProfile {
  const source = `${plan.businessName} ${plan.websiteType} ${plan.theme.style} ${plan.features.join(' ')}`.toLowerCase();
  const seed = hashText(source + plan.tagline);
  const profiles: Array<Omit<DesignProfile, 'seed'>> = [
    { key: 'aurora', label: 'Aurora intelligence', displayFont: 'Inter, ui-sans-serif, system-ui, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 26, maxWidth: 1380, density: 'balanced' },
    { key: 'orbital', label: 'Orbital product system', displayFont: 'Inter, ui-sans-serif, system-ui, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 32, maxWidth: 1420, density: 'airy' },
    { key: 'editorial', label: 'Editorial technology', displayFont: '"Arial Black", Impact, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 8, maxWidth: 1480, density: 'dense' },
    { key: 'monolith', label: 'Monolithic precision', displayFont: 'Inter, ui-sans-serif, system-ui, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 14, maxWidth: 1360, density: 'dense' },
    { key: 'glass', label: 'Immersive glass', displayFont: 'Inter, ui-sans-serif, system-ui, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 30, maxWidth: 1340, density: 'balanced' },
    { key: 'commerce', label: 'Conversion engine', displayFont: 'Inter, ui-sans-serif, system-ui, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 18, maxWidth: 1400, density: 'balanced' },
    { key: 'playful', label: 'Expressive launch', displayFont: '"Trebuchet MS", Inter, sans-serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 36, maxWidth: 1320, density: 'airy' },
    { key: 'organic', label: 'Human technology', displayFont: 'Georgia, "Times New Roman", serif', bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif', radius: 28, maxWidth: 1300, density: 'airy' }
  ];
  let index = seed % profiles.length;
  if (/glass|neon|cyber|futur/.test(source)) index = 4;
  else if (/shop|commerce|store/.test(source)) index = 5;
  else if (/editorial|portfolio|magazine/.test(source)) index = 2;
  else if (/organic|wellness|eco/.test(source)) index = 7;
  return { ...profiles[index], seed };
}

function createLogoSvg(plan: WebsitePlan, profile: DesignProfile): string {
  const primary = safeColour(plan.theme.primary, '#6d5dfc');
  const secondary = safeColour(plan.theme.secondary, '#22d3ee');
  const mark = initials(plan.businessName);
  const tilt = (profile.seed % 18) - 9;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${escapeHtml(plan.businessName)} logo"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${primary}"/><stop offset=".48" stop-color="${secondary}"/><stop offset="1" stop-color="${primary}"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="18"/></filter></defs><rect width="512" height="512" rx="132" fill="#070914"/><circle cx="256" cy="256" r="184" fill="none" stroke="url(#g)" stroke-width="18" opacity=".82"/><circle cx="355" cy="135" r="38" fill="${secondary}" filter="url(#b)" opacity=".8"/><g transform="rotate(${tilt} 256 256)"><path d="M122 350 197 119l64 135 61-135 68 231-80-84-49 111-54-111z" fill="url(#g)"/></g><text x="256" y="455" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="38" font-weight="800" letter-spacing="8" fill="white">${escapeHtml(mark)}</text></svg>`;
}

function featureDescription(feature: string, websiteType: string): string {
  const key = slugify(feature);
  const library: Record<string, string> = {
    'responsive-design': 'A fluid interface engineered for phones, tablets and wide desktop screens.',
    'seo': 'Clean semantic structure, meaningful metadata and fast-loading content foundations.',
    'custom-branding': 'A distinctive visual language shaped around the product, audience and market.',
    'smooth-animations': 'Purposeful motion that guides attention without slowing down the experience.',
    'pricing': 'Clear packages, confident comparisons and direct upgrade paths.',
    'testimonials': 'Trust-building customer stories arranged for quick scanning and credibility.',
    'faq': 'Accessible answers that remove hesitation before a visitor takes action.',
    'contact-form': 'A focused lead form with clear states, validation and conversion-first copy.',
    'gallery': 'A polished showcase system for products, projects, screenshots or visual proof.',
    'booking': 'A clear path from interest to appointment, demo or consultation.',
    'whatsapp': 'A direct mobile-first conversation path for faster enquiries and support.',
    'product-catalogue': 'Structured product discovery with category-led navigation and strong calls to action.'
  };
  return library[key] || `A production-ready ${titleCase(feature).toLowerCase()} experience designed specifically for a ${websiteType} audience.`;
}

function sectionFor(plan: WebsitePlan, index: number) {
  const fallback = [
    { title: 'Built for a clear outcome', body: `Turn interest in ${plan.businessName} into a confident next step with focused messaging and useful product detail.` },
    { title: 'A product story people understand', body: 'Explain the value, workflow and practical difference in a way that feels simple, credible and memorable.' },
    { title: 'Proof before promises', body: 'Use meaningful results, customer evidence, product views and trust signals instead of empty marketing claims.' },
    { title: 'Designed to convert', body: 'Every section has a purpose: educate, answer objections, demonstrate value or guide the visitor toward action.' },
    { title: 'Ready to launch', body: 'Responsive layouts, accessible interaction patterns and production-quality visual polish are included from the start.' }
  ];
  return plan.sections[index % Math.max(1, plan.sections.length)] || fallback[index % fallback.length];
}

const APP_RUNTIME = String.raw`
import { useEffect, useMemo, useState } from 'react';
import './styles.css';

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
}

function title(value) {
  return String(value || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (char) { return char.toUpperCase(); });
}

function pagesForPlan() {
  var requested = Array.isArray(plan.pages) ? plan.pages.map(slug).filter(Boolean) : [];
  var pages = ['home'].concat(requested.filter(function (page) { return page !== 'home'; }));
  var source = (plan.websiteType + ' ' + plan.features.join(' ')).toLowerCase();
  var candidates = /saas|software|technology|ai|startup/.test(source)
    ? ['product', 'solutions', 'templates', 'pricing', 'about', 'contact']
    : /shop|store|commerce|product/.test(source)
      ? ['shop', 'collections', 'why-us', 'reviews', 'about', 'contact']
      : ['services', 'process', 'results', 'about', 'faq', 'contact'];
  candidates.forEach(function (candidate) {
    if (pages.indexOf(candidate) === -1 && pages.length < 8) pages.push(candidate);
  });
  if (pages.indexOf('contact') === -1) pages.push('contact');
  return pages.slice(0, 8);
}

function useRoute(pages) {
  var initial = slug(window.location.hash.replace(/^#\/?/, '') || 'home');
  var state = useState(pages.indexOf(initial) >= 0 ? initial : 'home');
  var route = state[0];
  var setRoute = state[1];
  useEffect(function () {
    function change() {
      var next = slug(window.location.hash.replace(/^#\/?/, '') || 'home');
      setRoute(pages.indexOf(next) >= 0 ? next : 'home');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.addEventListener('hashchange', change);
    return function () { window.removeEventListener('hashchange', change); };
  }, [pages.join('|')]);
  return route;
}

function go(page) {
  window.location.hash = '#/' + slug(page);
}

function Reveal() {
  useEffect(function () {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) entry.target.classList.add('is-visible');
      });
    }, { threshold: .12 });
    document.querySelectorAll('[data-reveal]').forEach(function (element) { observer.observe(element); });
    return function () { observer.disconnect(); };
  });
  return null;
}

function ContactForm() {
  var statusState = useState('');
  var status = statusState[0];
  var setStatus = statusState[1];
  var busyState = useState(false);
  var busy = busyState[0];
  var setBusy = busyState[1];

  async function submit(event) {
    event.preventDefault();
    if (!FORM_URL) {
      setStatus('Your enquiry is ready. Connect a form endpoint to receive submissions.');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      var response = await fetch(FORM_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'Could not send your message.');
      event.currentTarget.reset();
      setStatus('Message sent successfully.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not send your message.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="lead-form" onSubmit={submit}>
    <div><label htmlFor="name">Name</label><input id="name" name="name" required maxLength="100" placeholder="Your name" /></div>
    <div><label htmlFor="email">Email</label><input id="email" name="email" type="email" required maxLength="160" placeholder="you@example.com" /></div>
    <div className="full"><label htmlFor="company">Company</label><input id="company" name="company" maxLength="160" placeholder="Company or project" /></div>
    <div className="full"><label htmlFor="message">What are you building?</label><textarea id="message" name="message" required maxLength="2400" rows="5" placeholder="Tell us about the outcome you need" /></div>
    <button className="primary-button" disabled={busy}>{busy ? 'Sending…' : 'Start the conversation'}</button>
    {status && <p className="form-status" role="status">{status}</p>}
  </form>;
}

function VisualConsole() {
  return <div className="visual-console" aria-label="Animated product preview">
    <div className="console-top"><span></span><span></span><span></span><strong>LIVE PRODUCT SIGNAL</strong></div>
    <div className="console-grid">
      <aside>
        <span className="active">Overview</span>
        <span>Automations</span>
        <span>Analytics</span>
        <span>Customers</span>
      </aside>
      <div className="console-main">
        <div className="signal-row"><div><small>Growth velocity</small><strong>+48.2%</strong></div><span className="live-dot">Live</span></div>
        <div className="chart">
          <i style={{ height: '38%' }}></i><i style={{ height: '52%' }}></i><i style={{ height: '46%' }}></i><i style={{ height: '71%' }}></i><i style={{ height: '64%' }}></i><i style={{ height: '88%' }}></i><i style={{ height: '96%' }}></i>
        </div>
        <div className="console-cards">
          <article><small>Active flows</small><strong>1,284</strong><span>↑ 18%</span></article>
          <article><small>Response time</small><strong>84ms</strong><span>Global</span></article>
          <article><small>Conversion</small><strong>24.8%</strong><span>Optimised</span></article>
        </div>
      </div>
    </div>
    <div className="floating-chip chip-a">AI workflow ready</div>
    <div className="floating-chip chip-b">99.99% uptime</div>
  </div>;
}

function LogoCloud() {
  return <section className="logo-cloud" data-reveal>
    <span>Trusted by teams building the next category</span>
    <div><b>ARC</b><b>VELOCITY</b><b>ORBIT</b><b>NORTHSTAR</b><b>PULSE</b><b>FORMA</b></div>
  </section>;
}

function FeatureBento() {
  var features = plan.features.length ? plan.features : ['responsive-design', 'custom-branding', 'smooth-animations', 'seo', 'analytics', 'automation'];
  return <section className="section-shell" data-reveal>
    <div className="section-heading">
      <span className="eyebrow">Product advantage</span>
      <h2>Everything important, arranged with intention.</h2>
      <p>Clear hierarchy, useful interaction and high-quality motion turn a long feature list into a product story people can understand.</p>
    </div>
    <div className="bento-grid">
      {features.slice(0, 6).map(function (feature, index) {
        return <article key={feature} className={'bento-card bento-' + index}>
          <span className="card-number">{String(index + 1).padStart(2, '0')}</span>
          <div className="mini-visual"><i></i><i></i><i></i></div>
          <h3>{title(feature)}</h3>
          <p>{featureCopy[feature] || 'A polished, production-ready capability designed around the visitor journey.'}</p>
        </article>;
      })}
    </div>
  </section>;
}

function ProcessSection() {
  var steps = [
    ['01', 'Understand the outcome', 'Start with the audience, problem, desired action and proof needed to earn trust.'],
    ['02', 'Shape the experience', 'Turn the strategy into pages, content hierarchy, interaction and a distinct visual system.'],
    ['03', 'Launch with confidence', 'Validate mobile behavior, accessibility, performance and conversion paths before release.']
  ];
  return <section className="process-section section-shell" data-reveal>
    <div className="section-heading compact"><span className="eyebrow">How it works</span><h2>From idea to a product people remember.</h2></div>
    <div className="process-grid">{steps.map(function (step) {
      return <article key={step[0]}><span>{step[0]}</span><h3>{step[1]}</h3><p>{step[2]}</p></article>;
    })}</div>
  </section>;
}

function StorySection() {
  var first = plan.sections[0] || { title: 'Built around a real outcome', body: plan.tagline };
  var second = plan.sections[1] || { title: 'Clarity at every step', body: 'A focused experience that gives visitors the information and confidence they need.' };
  return <section className="story-section section-shell" data-reveal>
    <div className="story-art">
      <div className="orbit orbit-one"></div><div className="orbit orbit-two"></div>
      <div className="story-metric"><small>Signal quality</small><strong>98.6</strong><span>↑ category leading</span></div>
      <div className="story-stack"><i></i><i></i><i></i><i></i></div>
    </div>
    <div className="story-copy"><span className="eyebrow">Why it matters</span><h2>{first.title}</h2><p>{first.body}</p><div className="story-note"><b>{second.title}</b><span>{second.body}</span></div><button className="text-button" onClick={function () { go('about'); }}>Read the full story →</button></div>
  </section>;
}

function Testimonials() {
  var quotes = [
    ['“The product finally feels as strong as the idea behind it.”', 'Aarav Mehta', 'Founder, Northstar'],
    ['“Clearer story, better conversion and a much more premium experience.”', 'Mira Shah', 'Growth Lead, Forma'],
    ['“The new flow helped customers understand our value in minutes.”', 'Kabir Rao', 'Product Director, Orbit']
  ];
  return <section className="section-shell testimonials" data-reveal>
    <div className="section-heading compact"><span className="eyebrow">Customer signal</span><h2>Trusted because the experience does the explaining.</h2></div>
    <div className="quote-grid">{quotes.map(function (quote, index) {
      return <article key={quote[1]}><span>{'★★★★★'.slice(0, 5 - (index % 2))}</span><blockquote>{quote[0]}</blockquote><div><i>{quote[1].charAt(0)}</i><p><b>{quote[1]}</b><small>{quote[2]}</small></p></div></article>;
    })}</div>
  </section>;
}

function Pricing() {
  var yearlyState = useState(true);
  var yearly = yearlyState[0];
  var setYearly = yearlyState[1];
  var plans = [
    ['Launch', yearly ? '₹999' : '₹1,299', ['Core product pages', 'Responsive experience', 'Contact capture', 'SEO foundation']],
    ['Scale', yearly ? '₹2,499' : '₹2,999', ['Everything in Launch', 'Advanced sections', 'Integrations', 'Priority optimisation']],
    ['Custom', 'Let’s talk', ['Tailored architecture', 'Custom workflows', 'Migration support', 'Dedicated partnership']]
  ];
  return <section className="section-shell pricing-section" data-reveal>
    <div className="section-heading pricing-heading"><div><span className="eyebrow">Simple pricing</span><h2>Choose the level that matches the ambition.</h2></div><button className="billing-toggle" onClick={function () { setYearly(!yearly); }}><span className={yearly ? 'active' : ''}>Yearly</span><span className={!yearly ? 'active' : ''}>Monthly</span></button></div>
    <div className="pricing-grid">{plans.map(function (item, index) {
      return <article key={item[0]} className={index === 1 ? 'featured' : ''}><span className="plan-label">{item[0]}</span><strong>{item[1]}</strong><small>{item[1].charAt(0) === '₹' ? '/ month' : 'Built around your needs'}</small><ul>{item[2].map(function (feature) { return <li key={feature}>{feature}</li>; })}</ul><button className={index === 1 ? 'primary-button' : 'secondary-button'} onClick={function () { go('contact'); }}>{index === 2 ? 'Contact sales' : 'Start now'}</button></article>;
    })}</div>
  </section>;
}

function FAQ() {
  var items = [
    ['How quickly can we get started?', 'A focused first version can be shaped quickly once the audience, offer and primary conversion goal are clear.'],
    ['Will it work properly on mobile?', 'Yes. Mobile hierarchy, navigation, spacing, touch targets and loading behavior are treated as core requirements.'],
    ['Can the pages and content be customised?', 'Every page, section, message and call to action can be adjusted around your exact product and market.'],
    ['Does it include working interactions?', 'Navigation, pricing controls, accordions, lead forms and responsive states are built as functional interface elements.']
  ];
  var openState = useState(0);
  var open = openState[0];
  var setOpen = openState[1];
  return <section className="faq-section section-shell" data-reveal>
    <div className="section-heading compact"><span className="eyebrow">Questions answered</span><h2>Everything needed to move forward confidently.</h2></div>
    <div className="faq-list">{items.map(function (item, index) {
      return <article key={item[0]} className={open === index ? 'open' : ''}><button onClick={function () { setOpen(open === index ? -1 : index); }}><span>{item[0]}</span><i>+</i></button><p>{item[1]}</p></article>;
    })}</div>
  </section>;
}

function CTA() {
  return <section className="final-cta section-shell" data-reveal>
    <div><span className="eyebrow">Ready when you are</span><h2>Turn the next idea into a product people want to explore.</h2></div>
    <button className="light-button" onClick={function () { go('contact'); }}>Start a project <span>↗</span></button>
  </section>;
}

function HomePage() {
  return <main>
    <header className="hero section-shell">
      <div className="hero-copy">
        <div className="announcement"><span>NEW</span><p>{design.label} for ambitious {plan.websiteType} teams</p></div>
        <span className="eyebrow">Made for the next category</span>
        <h1><span>{plan.businessName}</span><em>{plan.tagline}</em></h1>
        <p className="hero-description">{(plan.sections[0] && plan.sections[0].body) || 'A premium digital experience that turns complex value into a clear, compelling and memorable product story.'}</p>
        <div className="hero-actions"><button className="primary-button" onClick={function () { go(pages[1] || 'product'); }}>Explore the product</button><button className="secondary-button" onClick={function () { go('contact'); }}>Book a demo <span>↗</span></button></div>
        <div className="proof-row"><div className="avatars"><i>A</i><i>M</i><i>K</i><i>+</i></div><p><b>4.9/5</b><span>from product-focused teams</span></p></div>
      </div>
      <VisualConsole />
    </header>
    <LogoCloud />
    <FeatureBento />
    <ProcessSection />
    <StorySection />
    <Testimonials />
    <Pricing />
    <FAQ />
    <CTA />
  </main>;
}

function PageVisual(props) {
  var index = props.index;
  return <div className={'page-visual visual-variant-' + (index % 4)}>
    <div className="visual-ring"></div><div className="visual-core"></div>
    <div className="data-card data-one"><small>Active signal</small><strong>{92 + (design.seed % 7)}%</strong></div>
    <div className="data-card data-two"><small>Momentum</small><strong>+{34 + (index * 7)}%</strong></div>
  </div>;
}

function GenericPage(props) {
  var page = props.page;
  var index = props.index;
  var sourceSection = plan.sections[index % Math.max(1, plan.sections.length)] || { title: title(page), body: plan.tagline };
  var nextSection = plan.sections[(index + 1) % Math.max(1, plan.sections.length)] || sourceSection;
  var kind = slug(page);

  if (kind === 'pricing') return <main className="page-main"><div className="page-intro section-shell"><span className="eyebrow">Plans that scale</span><h1>Pricing built for momentum, not confusion.</h1><p>Start with the essentials and expand when the product, team or audience grows.</p></div><Pricing /><FAQ /><CTA /></main>;
  if (kind === 'contact') return <main className="page-main"><div className="contact-page section-shell"><div><span className="eyebrow">Start a conversation</span><h1>Tell us what the next version needs to achieve.</h1><p>Share the product, audience and desired outcome. The right experience starts with a clear problem.</p><div className="contact-points"><span>✓ Response within one business day</span><span>✓ Clear scope before work begins</span><span>✓ No generic one-size-fits-all process</span></div></div><ContactForm /></div></main>;
  if (kind === 'faq') return <main className="page-main"><div className="page-intro section-shell"><span className="eyebrow">Help centre</span><h1>Clear answers before the next step.</h1><p>Everything visitors usually need to know about the product, process and support.</p></div><FAQ /><CTA /></main>;

  return <main className="page-main">
    <header className="page-hero section-shell">
      <div><span className="eyebrow">{String(index + 1).padStart(2, '0')} · {title(page)}</span><h1>{sourceSection.title}</h1><p>{sourceSection.body}</p><button className="primary-button" onClick={function () { go('contact'); }}>Discuss your use case</button></div>
      <PageVisual index={index} />
    </header>
    <section className={'page-layout layout-' + (index % 4) + ' section-shell'} data-reveal>
      <div className="page-copy"><span className="eyebrow">Built with purpose</span><h2>{nextSection.title}</h2><p>{nextSection.body}</p></div>
      <div className="page-card-grid">
        {plan.features.slice(0, 6).map(function (feature, featureIndex) {
          return <article key={feature}><span>{String(featureIndex + 1).padStart(2, '0')}</span><h3>{title(feature)}</h3><p>{featureCopy[feature] || 'A focused capability designed to improve clarity, trust and action.'}</p></article>;
        })}
      </div>
    </section>
    <ProcessSection />
    {index % 2 === 0 ? <Testimonials /> : <StorySection />}
    <CTA />
  </main>;
}

function Navigation(props) {
  var pages = props.pages;
  var route = props.route;
  var menuState = useState(false);
  var menu = menuState[0];
  var setMenu = menuState[1];
  return <nav className="navigation">
    <button className="brand" onClick={function () { go('home'); }}><img src="/logo.svg" alt="" /><span>{plan.businessName}</span></button>
    <div className={'nav-links ' + (menu ? 'open' : '')}>{pages.map(function (page) {
      return <button key={page} className={route === page ? 'active' : ''} onClick={function () { setMenu(false); go(page); }}>{title(page)}</button>;
    })}</div>
    <button className="nav-cta" onClick={function () { go('contact'); }}>Get started <span>↗</span></button>
    <button className="menu-button" aria-label="Toggle menu" onClick={function () { setMenu(!menu); }}><i></i><i></i></button>
  </nav>;
}

function App() {
  var pages = useMemo(pagesForPlan, []);
  var route = useRoute(pages);
  var index = Math.max(0, pages.indexOf(route));
  return <div className={'site profile-' + design.key}>
    <Reveal />
    <div className="ambient ambient-one"></div><div className="ambient ambient-two"></div><div className="grid-overlay"></div>
    <Navigation pages={pages} route={route} />
    <div key={route} className="route-enter">{route === 'home' ? <HomePage /> : <GenericPage page={route} index={index} />}</div>
    <footer className="footer section-shell"><div><button className="brand footer-brand" onClick={function () { go('home'); }}><img src="/logo.svg" alt="" /><span>{plan.businessName}</span></button><p>{plan.tagline}</p></div><div className="footer-pages">{pages.map(function (page) { return <button key={page} onClick={function () { go(page); }}>{title(page)}</button>; })}</div><small>© {new Date().getFullYear()} {plan.businessName} · Made by Poojak Doshi</small></footer>
  </div>;
}

export default App;
`;

function createAppSource(plan: WebsitePlan, options: ProjectBuildOptions, profile: DesignProfile): string {
  const formUrl = options.formApiBase && options.formPublicKey
    ? `${options.formApiBase.replace(/\/$/, '')}/public/forms/${options.formPublicKey}/submit`
    : '';
  const featureCopy = Object.fromEntries(plan.features.map((feature) => [feature, featureDescription(feature, plan.websiteType)]));
  return [
    `const plan = ${JSON.stringify(plan, null, 2)};`,
    `const design = ${JSON.stringify(profile, null, 2)};`,
    `const FORM_URL = ${JSON.stringify(formUrl)};`,
    `const featureCopy = ${JSON.stringify(featureCopy, null, 2)};`,
    APP_RUNTIME
  ].join('\n');
}

function createStyles(plan: WebsitePlan, profile: DesignProfile): string {
  const primary = safeColour(plan.theme.primary, '#6d5dfc');
  const secondary = safeColour(plan.theme.secondary, '#22d3ee');
  const background = safeColour(plan.theme.background, '#070914');
  const text = safeColour(plan.theme.text, '#f7f8ff');
  const primarySoft = rgba(primary, .2);
  const secondarySoft = rgba(secondary, .16);
  const textSoft = rgba(text, .68);
  const line = rgba(text, .12);
  const surface = rgba(text, .055);
  const surfaceStrong = rgba(text, .09);
  return `:root{font-family:${profile.bodyFont};color:${text};background:${background};font-synthesis:none;text-rendering:optimizeLegibility;--primary:${primary};--secondary:${secondary};--bg:${background};--text:${text};--text-soft:${textSoft};--line:${line};--surface:${surface};--surface-strong:${surfaceStrong};--primary-soft:${primarySoft};--secondary-soft:${secondarySoft};--radius:${profile.radius}px;--radius-lg:${Math.max(30, profile.radius * 1.8)}px;--max:${profile.maxWidth}px;--display:${profile.displayFont}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-width:320px;background:var(--bg);color:var(--text);overflow-x:hidden}button,input,textarea{font:inherit}button{color:inherit}.site{position:relative;min-height:100vh;overflow:hidden}.section-shell{width:min(calc(100% - 40px),var(--max));margin-inline:auto}.ambient{position:fixed;z-index:-3;border-radius:999px;filter:blur(90px);opacity:.42;pointer-events:none}.ambient-one{width:540px;height:540px;right:-140px;top:-130px;background:var(--primary);animation:ambientFloat 12s ease-in-out infinite}.ambient-two{width:470px;height:470px;left:-190px;top:38%;background:var(--secondary);animation:ambientFloat 15s ease-in-out infinite reverse}.grid-overlay{position:fixed;z-index:-2;inset:0;pointer-events:none;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.55),transparent 78%);opacity:.17}.navigation{position:sticky;top:0;z-index:100;width:min(calc(100% - 28px),calc(var(--max) + 60px));margin:14px auto 0;min-height:64px;padding:10px 12px 10px 16px;border:1px solid var(--line);border-radius:22px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:22px;background:${rgba(background,.72)};backdrop-filter:blur(24px);box-shadow:0 18px 55px rgba(0,0,0,.24)}.brand{border:0;background:none;padding:0;display:inline-flex;align-items:center;gap:11px;text-align:left;font-weight:850;letter-spacing:-.03em;cursor:pointer}.brand img{width:40px;height:40px;border-radius:13px;box-shadow:0 12px 30px var(--primary-soft)}.nav-links{display:flex;align-items:center;gap:4px}.nav-links button,.footer-pages button{border:0;background:none;padding:10px 12px;border-radius:12px;color:var(--text-soft);font-size:13px;cursor:pointer;text-transform:capitalize}.nav-links button:hover,.nav-links button.active,.footer-pages button:hover{color:var(--text);background:var(--surface)}.nav-cta{justify-self:end;border:0;border-radius:14px;padding:12px 16px;background:var(--text);color:var(--bg);font-weight:850;cursor:pointer}.nav-cta span{margin-left:8px}.menu-button{display:none;border:0;background:var(--surface);width:44px;height:44px;border-radius:13px}.menu-button i{display:block;width:18px;height:1px;background:var(--text);margin:5px auto}.route-enter{animation:routeIn .55s cubic-bezier(.2,.75,.25,1)}.hero{min-height:calc(100vh - 90px);display:grid;grid-template-columns:minmax(0,1.03fr) minmax(420px,.97fr);align-items:center;gap:clamp(40px,7vw,110px);padding:80px 0 96px}.announcement{width:max-content;max-width:100%;display:flex;align-items:center;gap:10px;padding:7px 12px 7px 7px;border:1px solid var(--line);border-radius:999px;background:var(--surface);margin-bottom:28px}.announcement span{padding:6px 8px;border-radius:999px;background:var(--primary);color:white;font-size:10px;font-weight:900}.announcement p{font-size:12px;color:var(--text-soft);margin:0}.eyebrow{font-size:11px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:var(--secondary)}.hero h1{font-family:var(--display);margin:18px 0 24px;display:grid;gap:12px;letter-spacing:-.065em}.hero h1 span{font-size:clamp(62px,9.2vw,142px);line-height:.82}.hero h1 em{max-width:850px;font-style:normal;font-size:clamp(28px,4vw,56px);line-height:1;letter-spacing:-.045em;color:var(--text-soft);font-weight:560}.hero-description{max-width:720px;font-size:18px;line-height:1.75;color:var(--text-soft)}.hero-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:31px}.primary-button,.secondary-button,.light-button,.text-button{border:0;cursor:pointer}.primary-button,.secondary-button{min-height:52px;padding:14px 20px;border-radius:15px;font-weight:850}.primary-button{background:linear-gradient(135deg,var(--primary),var(--secondary));color:white;box-shadow:0 20px 48px var(--primary-soft)}.secondary-button{background:var(--surface);border:1px solid var(--line)}.secondary-button span{margin-left:9px}.proof-row{display:flex;align-items:center;gap:13px;margin-top:34px}.avatars{display:flex}.avatars i{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;margin-left:-8px;border:2px solid var(--bg);background:linear-gradient(145deg,var(--primary),var(--secondary));font-size:11px;font-style:normal;font-weight:900}.avatars i:first-child{margin-left:0}.proof-row p{display:grid;margin:0;font-size:12px}.proof-row span{color:var(--text-soft)}.visual-console{position:relative;min-height:610px;padding:18px;border:1px solid var(--line);border-radius:var(--radius-lg);background:linear-gradient(145deg,var(--surface-strong),${rgba(background,.72)});box-shadow:0 50px 130px rgba(0,0,0,.38),inset 0 1px rgba(255,255,255,.08);transform:perspective(1200px) rotateY(-4deg) rotateX(2deg);animation:consoleFloat 7s ease-in-out infinite}.console-top{height:48px;display:flex;align-items:center;gap:7px;padding:0 12px;border-bottom:1px solid var(--line)}.console-top>span{width:8px;height:8px;border-radius:50%;background:var(--line)}.console-top strong{margin-left:auto;font-size:10px;letter-spacing:.15em;color:var(--text-soft)}.console-grid{display:grid;grid-template-columns:145px 1fr;min-height:510px}.console-grid aside{padding:24px 12px;border-right:1px solid var(--line);display:grid;align-content:start;gap:8px}.console-grid aside span{padding:11px 12px;border-radius:10px;color:var(--text-soft);font-size:12px}.console-grid aside .active{background:var(--primary-soft);color:var(--text)}.console-main{padding:30px}.signal-row{display:flex;justify-content:space-between;align-items:start}.signal-row div{display:grid;gap:5px}.signal-row small,.console-cards small{color:var(--text-soft)}.signal-row strong{font-size:46px;letter-spacing:-.055em}.live-dot{padding:8px 11px;border-radius:999px;background:rgba(34,197,94,.12);color:#6ee7a0;font-size:11px}.chart{height:220px;display:flex;align-items:end;gap:10px;margin:42px 0 24px;padding:20px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,var(--surface),transparent)}.chart i{flex:1;min-width:8px;border-radius:999px 999px 5px 5px;background:linear-gradient(to top,var(--primary),var(--secondary));box-shadow:0 0 25px var(--primary-soft);animation:bars 4s ease-in-out infinite}.chart i:nth-child(2n){animation-delay:-1.3s}.console-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.console-cards article{padding:17px;border:1px solid var(--line);border-radius:15px;background:var(--surface);display:grid;gap:7px}.console-cards strong{font-size:21px}.console-cards span{font-size:10px;color:var(--secondary)}.floating-chip{position:absolute;padding:11px 14px;border:1px solid var(--line);border-radius:999px;background:${rgba(background,.82)};backdrop-filter:blur(14px);font-size:11px;box-shadow:0 18px 44px rgba(0,0,0,.28);animation:chipFloat 5s ease-in-out infinite}.chip-a{left:-34px;top:23%}.chip-b{right:-25px;bottom:18%;animation-delay:-2s}.logo-cloud{width:min(calc(100% - 40px),var(--max));margin:0 auto 110px;padding:28px 0;border-block:1px solid var(--line);display:grid;gap:25px;text-align:center}.logo-cloud>span{font-size:11px;text-transform:uppercase;letter-spacing:.15em;color:var(--text-soft)}.logo-cloud div{display:flex;justify-content:space-around;gap:30px;flex-wrap:wrap;color:var(--text-soft)}.logo-cloud b{font-size:13px;letter-spacing:.12em}.section-shell[data-reveal],.logo-cloud[data-reveal]{opacity:0;transform:translateY(36px);transition:opacity .75s ease,transform .75s cubic-bezier(.2,.75,.25,1)}[data-reveal].is-visible{opacity:1;transform:none}.section-heading{max-width:880px;margin-bottom:44px}.section-heading h2,.story-copy h2,.page-copy h2,.final-cta h2{font-family:var(--display);font-size:clamp(42px,6vw,82px);line-height:.95;letter-spacing:-.055em;margin:15px 0 22px}.section-heading p,.story-copy>p,.page-copy>p{font-size:17px;line-height:1.8;color:var(--text-soft)}.section-heading.compact{max-width:760px}.bento-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px;margin-bottom:130px}.bento-card{position:relative;min-height:280px;padding:27px;border:1px solid var(--line);border-radius:var(--radius);background:linear-gradient(145deg,var(--surface-strong),var(--surface));overflow:hidden}.bento-card:before{content:"";position:absolute;width:200px;height:200px;border-radius:50%;right:-90px;top:-100px;background:var(--primary);filter:blur(65px);opacity:.16}.bento-0,.bento-3{grid-column:span 7}.bento-1,.bento-2{grid-column:span 5}.bento-4,.bento-5{grid-column:span 6}.card-number{font-size:11px;color:var(--secondary)}.mini-visual{height:90px;margin:23px 0;display:flex;align-items:end;gap:8px}.mini-visual i{flex:1;border-radius:999px;background:linear-gradient(to top,var(--primary),var(--secondary));opacity:.62}.mini-visual i:nth-child(1){height:35%}.mini-visual i:nth-child(2){height:80%}.mini-visual i:nth-child(3){height:55%}.bento-card h3{font-size:22px;margin:0 0 10px}.bento-card p{max-width:560px;color:var(--text-soft);line-height:1.7;margin:0}.process-section{margin-bottom:140px}.process-grid{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);border-radius:var(--radius-lg);overflow:hidden;background:var(--surface)}.process-grid article{min-height:280px;padding:32px}.process-grid article+article{border-left:1px solid var(--line)}.process-grid span{font-family:var(--display);font-size:42px;color:var(--primary)}.process-grid h3{font-size:24px;margin:60px 0 12px}.process-grid p{color:var(--text-soft);line-height:1.7}.story-section{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:clamp(45px,8vw,120px);margin-bottom:145px}.story-art{position:relative;min-height:560px;border:1px solid var(--line);border-radius:var(--radius-lg);background:radial-gradient(circle at 50% 50%,var(--primary-soft),transparent 45%),var(--surface);overflow:hidden}.orbit{position:absolute;border:1px solid var(--line);border-radius:50%;animation:spin 13s linear infinite}.orbit-one{width:430px;height:430px;left:50%;top:50%;margin:-215px}.orbit-two{width:270px;height:270px;left:50%;top:50%;margin:-135px;animation-direction:reverse;animation-duration:9s}.orbit:after{content:"";position:absolute;width:18px;height:18px;border-radius:50%;background:var(--secondary);left:50%;top:-9px;box-shadow:0 0 30px var(--secondary)}.story-metric{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:190px;height:190px;border-radius:50%;display:grid;place-content:center;text-align:center;background:${rgba(background,.82)};border:1px solid var(--line);box-shadow:0 25px 70px rgba(0,0,0,.32)}.story-metric small,.story-metric span{color:var(--text-soft)}.story-metric strong{font-size:46px}.story-stack{position:absolute;right:24px;bottom:24px;display:flex;gap:6px}.story-stack i{width:28px;height:90px;border-radius:8px;background:linear-gradient(to top,var(--primary),var(--secondary));opacity:.65}.story-stack i:nth-child(2){height:130px}.story-stack i:nth-child(3){height:105px}.story-stack i:nth-child(4){height:160px}.story-note{display:grid;gap:8px;padding:20px;margin:28px 0;border-left:2px solid var(--secondary);background:var(--surface)}.story-note span{color:var(--text-soft);line-height:1.6}.text-button{background:none;padding:0;color:var(--secondary);font-weight:800}.testimonials{margin-bottom:140px}.quote-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.quote-grid article{min-height:300px;padding:28px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);display:flex;flex-direction:column}.quote-grid>article>span{color:#fbbf24;letter-spacing:.12em}.quote-grid blockquote{font-family:var(--display);font-size:24px;line-height:1.35;margin:32px 0 auto}.quote-grid article>div{display:flex;align-items:center;gap:12px;margin-top:25px}.quote-grid i{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,var(--primary),var(--secondary));font-style:normal;font-weight:900}.quote-grid p{display:grid;margin:0}.quote-grid small{color:var(--text-soft)}.pricing-section{margin-bottom:140px}.pricing-heading{max-width:none;display:flex;align-items:end;justify-content:space-between;gap:30px}.pricing-heading>div{max-width:780px}.billing-toggle{display:flex;gap:4px;padding:5px;border:1px solid var(--line);border-radius:999px;background:var(--surface)}.billing-toggle span{padding:10px 13px;border-radius:999px;color:var(--text-soft);font-size:12px}.billing-toggle .active{background:var(--text);color:var(--bg)}.pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-items:stretch}.pricing-grid article{padding:30px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);display:flex;flex-direction:column}.pricing-grid article.featured{transform:translateY(-14px);background:linear-gradient(145deg,var(--primary-soft),var(--surface));box-shadow:0 30px 80px var(--primary-soft)}.plan-label{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:var(--secondary)}.pricing-grid strong{font-size:42px;margin:25px 0 2px}.pricing-grid>article>small{color:var(--text-soft)}.pricing-grid ul{display:grid;gap:13px;padding:0;margin:31px 0;list-style:none}.pricing-grid li:before{content:"✓";margin-right:10px;color:var(--secondary)}.pricing-grid article button{margin-top:auto}.faq-section{display:grid;grid-template-columns:.8fr 1.2fr;gap:70px;margin-bottom:140px}.faq-list{border-top:1px solid var(--line)}.faq-list article{border-bottom:1px solid var(--line)}.faq-list button{width:100%;padding:22px 0;border:0;background:none;display:flex;justify-content:space-between;text-align:left;font-weight:800}.faq-list i{font-style:normal;font-size:22px;transition:.2s}.faq-list p{max-height:0;overflow:hidden;margin:0;color:var(--text-soft);line-height:1.7;transition:.3s ease}.faq-list article.open p{max-height:160px;padding-bottom:22px}.faq-list article.open i{transform:rotate(45deg)}.final-cta{margin-bottom:80px;padding:clamp(32px,6vw,74px);border-radius:var(--radius-lg);display:flex;justify-content:space-between;align-items:end;gap:40px;background:linear-gradient(135deg,var(--primary),var(--secondary));color:white;box-shadow:0 35px 100px var(--primary-soft)}.final-cta>div{max-width:900px}.final-cta h2{margin-bottom:0}.final-cta .eyebrow{color:rgba(255,255,255,.78)}.light-button{flex:0 0 auto;padding:17px 20px;border-radius:15px;background:white;color:#0a0b14;font-weight:900}.light-button span{margin-left:14px}.page-main{padding-top:50px}.page-hero{min-height:720px;display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:80px;padding:70px 0 100px}.page-hero h1,.page-intro h1,.contact-page h1{font-family:var(--display);font-size:clamp(54px,8vw,112px);line-height:.9;letter-spacing:-.06em;margin:20px 0 25px}.page-hero>div>p,.page-intro p,.contact-page>div>p{font-size:18px;line-height:1.8;color:var(--text-soft);max-width:720px}.page-visual{position:relative;min-height:520px;border:1px solid var(--line);border-radius:var(--radius-lg);background:radial-gradient(circle,var(--primary-soft),transparent 53%),var(--surface);overflow:hidden}.visual-ring{position:absolute;width:360px;height:360px;border:1px solid var(--line);border-radius:50%;left:50%;top:50%;transform:translate(-50%,-50%);animation:spin 11s linear infinite}.visual-ring:after{content:"";position:absolute;width:22px;height:22px;border-radius:50%;background:var(--secondary);left:50%;top:-11px;box-shadow:0 0 34px var(--secondary)}.visual-core{position:absolute;width:180px;height:180px;border-radius:44px;left:50%;top:50%;transform:translate(-50%,-50%) rotate(18deg);background:linear-gradient(145deg,var(--primary),var(--secondary));box-shadow:0 0 80px var(--primary-soft);animation:coreFloat 6s ease-in-out infinite}.data-card{position:absolute;padding:16px;border:1px solid var(--line);border-radius:15px;background:${rgba(background,.78)};backdrop-filter:blur(16px);display:grid;gap:4px}.data-card small{color:var(--text-soft)}.data-card strong{font-size:24px}.data-one{left:24px;top:24px}.data-two{right:24px;bottom:24px}.page-layout{display:grid;grid-template-columns:.72fr 1.28fr;gap:80px;align-items:start;margin-bottom:130px}.page-copy{position:sticky;top:110px}.page-card-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:13px}.page-card-grid article{min-height:220px;padding:25px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.page-card-grid article>span{color:var(--secondary);font-size:11px}.page-card-grid h3{font-size:21px;margin:45px 0 11px}.page-card-grid p{color:var(--text-soft);line-height:1.7}.layout-1{grid-template-columns:1.1fr .9fr}.layout-1 .page-copy{order:2}.layout-1 .page-card-grid{order:1}.layout-2 .page-card-grid article:nth-child(1),.layout-2 .page-card-grid article:nth-child(4){grid-column:1/-1}.layout-3{grid-template-columns:1fr}.layout-3 .page-copy{position:static;max-width:800px}.layout-3 .page-card-grid{grid-template-columns:repeat(3,1fr)}.page-intro{padding:100px 0 55px}.contact-page{min-height:780px;padding:110px 0;display:grid;grid-template-columns:.85fr 1.15fr;gap:90px;align-items:start}.contact-points{display:grid;gap:12px;margin-top:30px;color:var(--text-soft)}.lead-form{padding:30px;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--surface);display:grid;grid-template-columns:1fr 1fr;gap:14px}.lead-form>div{display:grid;gap:8px}.lead-form .full{grid-column:1/-1}.lead-form label{font-size:12px;color:var(--text-soft)}.lead-form input,.lead-form textarea{width:100%;padding:14px 15px;border:1px solid var(--line);border-radius:12px;background:${rgba(background,.55)};color:var(--text);outline:none}.lead-form input:focus,.lead-form textarea:focus{border-color:var(--secondary);box-shadow:0 0 0 4px var(--secondary-soft)}.form-status{grid-column:1/-1;color:var(--secondary)}.footer{padding:50px 0 36px;border-top:1px solid var(--line);display:grid;grid-template-columns:1fr auto;gap:35px}.footer p{max-width:540px;color:var(--text-soft)}.footer-pages{display:flex;gap:4px;flex-wrap:wrap;justify-content:end}.footer small{grid-column:1/-1;color:var(--text-soft)}.profile-editorial .hero h1 span{text-transform:uppercase}.profile-editorial .visual-console,.profile-monolith .visual-console{border-radius:14px}.profile-orbital .hero{grid-template-columns:.9fr 1.1fr}.profile-playful .visual-console{transform:rotate(1.5deg)}.profile-organic .visual-console{border-radius:120px 120px 28px 28px}@keyframes ambientFloat{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(-50px,70px,0) scale(1.16)}}@keyframes consoleFloat{0%,100%{transform:perspective(1200px) rotateY(-4deg) rotateX(2deg) translateY(0)}50%{transform:perspective(1200px) rotateY(-2deg) rotateX(1deg) translateY(-12px)}}@keyframes chipFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-11px)}}@keyframes bars{0%,100%{filter:saturate(1);transform:scaleY(.92)}50%{filter:saturate(1.5);transform:scaleY(1.05)}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes coreFloat{0%,100%{transform:translate(-50%,-50%) rotate(18deg) scale(1)}50%{transform:translate(-50%,-50%) rotate(28deg) scale(1.08)}}@keyframes routeIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}@media(max-width:1050px){.navigation{grid-template-columns:1fr auto auto}.nav-links{position:absolute;left:0;right:0;top:72px;padding:12px;display:none;grid-template-columns:1fr 1fr;background:${rgba(background,.96)};border:1px solid var(--line);border-radius:18px}.nav-links.open{display:grid}.nav-cta{display:none}.menu-button{display:block}.hero,.page-hero,.story-section,.faq-section,.contact-page{grid-template-columns:1fr}.hero{padding-top:70px}.visual-console{min-height:560px;transform:none}.page-visual{min-height:440px}.page-layout,.layout-1{grid-template-columns:1fr}.page-copy{position:static}.layout-1 .page-copy,.layout-1 .page-card-grid{order:initial}.pricing-grid{grid-template-columns:1fr}.pricing-grid article.featured{transform:none}.quote-grid{grid-template-columns:1fr}.final-cta{align-items:start;flex-direction:column}.contact-page{gap:45px}}@media(max-width:720px){.section-shell,.logo-cloud{width:min(calc(100% - 28px),var(--max))}.navigation{margin-top:8px;width:calc(100% - 16px);border-radius:17px}.brand span{max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hero{padding:60px 0 80px}.hero h1 span{font-size:clamp(52px,18vw,88px)}.hero h1 em{font-size:clamp(25px,8vw,40px)}.visual-console{min-height:480px;padding:10px}.console-grid{grid-template-columns:1fr}.console-grid aside{display:none}.console-main{padding:18px}.signal-row strong{font-size:36px}.chart{height:180px;margin:30px 0 18px}.console-cards{grid-template-columns:1fr 1fr}.console-cards article:nth-child(3){display:none}.floating-chip{display:none}.bento-grid{grid-template-columns:1fr}.bento-card,.bento-0,.bento-1,.bento-2,.bento-3,.bento-4,.bento-5{grid-column:auto}.process-grid{grid-template-columns:1fr}.process-grid article+article{border-left:0;border-top:1px solid var(--line)}.story-art{min-height:430px}.orbit-one{width:330px;height:330px;margin:-165px}.orbit-two{width:220px;height:220px;margin:-110px}.pricing-heading{align-items:start;flex-direction:column}.page-hero{min-height:auto;padding:55px 0 80px}.page-hero h1,.page-intro h1,.contact-page h1{font-size:clamp(50px,15vw,78px)}.page-card-grid,.layout-3 .page-card-grid{grid-template-columns:1fr}.page-card-grid article:nth-child(1),.page-card-grid article:nth-child(4){grid-column:auto}.lead-form{grid-template-columns:1fr}.lead-form .full{grid-column:auto}.footer{grid-template-columns:1fr}.footer-pages{justify-content:start}.final-cta{padding:30px}.final-cta h2{font-size:42px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;scroll-behavior:auto!important;transition:none!important}}`;
}

function renderFeatureCards(plan: WebsitePlan): string {
  const features = plan.features.length ? plan.features : ['responsive-design', 'custom-branding', 'smooth-animations', 'seo', 'analytics', 'automation'];
  return features.slice(0, 6).map((feature, index) => `<article class="bento-card bento-${index}"><span class="card-number">${String(index + 1).padStart(2, '0')}</span><div class="mini-visual"><i></i><i></i><i></i></div><h3>${escapeHtml(titleCase(feature))}</h3><p>${escapeHtml(featureDescription(feature, plan.websiteType))}</p></article>`).join('');
}

function renderPricing(): string {
  return `<section class="section-shell pricing-section" data-reveal><div class="section-heading"><span class="eyebrow">Simple pricing</span><h2>Choose the level that matches the ambition.</h2></div><div class="pricing-grid"><article><span class="plan-label">Launch</span><strong>₹999</strong><small>/ month</small><ul><li>Core product pages</li><li>Responsive experience</li><li>Contact capture</li><li>SEO foundation</li></ul><button class="secondary-button" data-route="contact">Start now</button></article><article class="featured"><span class="plan-label">Scale</span><strong>₹2,499</strong><small>/ month</small><ul><li>Everything in Launch</li><li>Advanced sections</li><li>Integrations</li><li>Priority optimisation</li></ul><button class="primary-button" data-route="contact">Choose Scale</button></article><article><span class="plan-label">Custom</span><strong>Let’s talk</strong><small>Built around your needs</small><ul><li>Tailored architecture</li><li>Custom workflows</li><li>Migration support</li><li>Dedicated partnership</li></ul><button class="secondary-button" data-route="contact">Contact sales</button></article></div></section>`;
}

function renderFaq(): string {
  return `<section class="faq-section section-shell" data-reveal><div class="section-heading compact"><span class="eyebrow">Questions answered</span><h2>Everything needed to move forward confidently.</h2></div><div class="faq-list">${[
    ['How quickly can we get started?', 'A focused first version can be shaped quickly once the audience, offer and primary conversion goal are clear.'],
    ['Will it work properly on mobile?', 'Yes. Mobile hierarchy, navigation, spacing, touch targets and loading behavior are treated as core requirements.'],
    ['Can the pages and content be customised?', 'Every page, section, message and call to action can be adjusted around your exact product and market.'],
    ['Does it include working interactions?', 'Navigation, accordions, lead forms and responsive states are built as functional interface elements.']
  ].map((item, index) => `<article class="${index === 0 ? 'open' : ''}"><button type="button"><span>${escapeHtml(item[0])}</span><i>+</i></button><p>${escapeHtml(item[1])}</p></article>`).join('')}</div></section>`;
}

function renderHomePreview(plan: WebsitePlan, profile: DesignProfile): string {
  const first = sectionFor(plan, 0);
  return `<main data-page="home"><header class="hero section-shell"><div class="hero-copy"><div class="announcement"><span>NEW</span><p>${escapeHtml(profile.label)} for ambitious ${escapeHtml(plan.websiteType)} teams</p></div><span class="eyebrow">Made for the next category</span><h1><span>${escapeHtml(plan.businessName)}</span><em>${escapeHtml(plan.tagline)}</em></h1><p class="hero-description">${escapeHtml(first.body)}</p><div class="hero-actions"><button class="primary-button" data-route="product">Explore the product</button><button class="secondary-button" data-route="contact">Book a demo <span>↗</span></button></div><div class="proof-row"><div class="avatars"><i>A</i><i>M</i><i>K</i><i>+</i></div><p><b>4.9/5</b><span>from product-focused teams</span></p></div></div><div class="visual-console"><div class="console-top"><span></span><span></span><span></span><strong>LIVE PRODUCT SIGNAL</strong></div><div class="console-grid"><aside><span class="active">Overview</span><span>Automations</span><span>Analytics</span><span>Customers</span></aside><div class="console-main"><div class="signal-row"><div><small>Growth velocity</small><strong>+48.2%</strong></div><span class="live-dot">Live</span></div><div class="chart"><i style="height:38%"></i><i style="height:52%"></i><i style="height:46%"></i><i style="height:71%"></i><i style="height:64%"></i><i style="height:88%"></i><i style="height:96%"></i></div><div class="console-cards"><article><small>Active flows</small><strong>1,284</strong><span>↑ 18%</span></article><article><small>Response time</small><strong>84ms</strong><span>Global</span></article><article><small>Conversion</small><strong>24.8%</strong><span>Optimised</span></article></div></div></div><div class="floating-chip chip-a">AI workflow ready</div><div class="floating-chip chip-b">99.99% uptime</div></div></header><section class="logo-cloud" data-reveal><span>Trusted by teams building the next category</span><div><b>ARC</b><b>VELOCITY</b><b>ORBIT</b><b>NORTHSTAR</b><b>PULSE</b><b>FORMA</b></div></section><section class="section-shell" data-reveal><div class="section-heading"><span class="eyebrow">Product advantage</span><h2>Everything important, arranged with intention.</h2><p>Clear hierarchy, useful interaction and high-quality motion turn a feature list into a product story people can understand.</p></div><div class="bento-grid">${renderFeatureCards(plan)}</div></section><section class="process-section section-shell" data-reveal><div class="section-heading compact"><span class="eyebrow">How it works</span><h2>From idea to a product people remember.</h2></div><div class="process-grid"><article><span>01</span><h3>Understand the outcome</h3><p>Start with the audience, problem, desired action and proof needed to earn trust.</p></article><article><span>02</span><h3>Shape the experience</h3><p>Turn the strategy into pages, hierarchy, interaction and a distinct visual system.</p></article><article><span>03</span><h3>Launch with confidence</h3><p>Validate mobile behavior, accessibility, performance and conversion paths.</p></article></div></section>${renderPricing()}${renderFaq()}<section class="final-cta section-shell" data-reveal><div><span class="eyebrow">Ready when you are</span><h2>Turn the next idea into a product people want to explore.</h2></div><button class="light-button" data-route="contact">Start a project <span>↗</span></button></section></main>`;
}

function renderGenericPreview(plan: WebsitePlan, page: string, index: number): string {
  const section = sectionFor(plan, index);
  const next = sectionFor(plan, index + 1);
  if (page === 'pricing') return `<main class="page-main" data-page="${page}" hidden><div class="page-intro section-shell"><span class="eyebrow">Plans that scale</span><h1>Pricing built for momentum, not confusion.</h1><p>Start with the essentials and expand when the product, team or audience grows.</p></div>${renderPricing()}${renderFaq()}</main>`;
  if (page === 'contact') return `<main class="page-main" data-page="${page}" hidden><div class="contact-page section-shell"><div><span class="eyebrow">Start a conversation</span><h1>Tell us what the next version needs to achieve.</h1><p>Share the product, audience and desired outcome. The right experience starts with a clear problem.</p><div class="contact-points"><span>✓ Response within one business day</span><span>✓ Clear scope before work begins</span><span>✓ No generic one-size-fits-all process</span></div></div><form class="lead-form"><div><label>Name</label><input required placeholder="Your name"></div><div><label>Email</label><input required type="email" placeholder="you@example.com"></div><div class="full"><label>What are you building?</label><textarea rows="5" placeholder="Tell us about the outcome you need"></textarea></div><button class="primary-button">Start the conversation</button><p class="form-status"></p></form></div></main>`;
  if (page === 'faq') return `<main class="page-main" data-page="${page}" hidden><div class="page-intro section-shell"><span class="eyebrow">Help centre</span><h1>Clear answers before the next step.</h1><p>Everything visitors usually need to know about the product, process and support.</p></div>${renderFaq()}</main>`;
  return `<main class="page-main" data-page="${escapeHtml(page)}" hidden><header class="page-hero section-shell"><div><span class="eyebrow">${String(index + 1).padStart(2, '0')} · ${escapeHtml(titleCase(page))}</span><h1>${escapeHtml(section.title)}</h1><p>${escapeHtml(section.body)}</p><button class="primary-button" data-route="contact">Discuss your use case</button></div><div class="page-visual visual-variant-${index % 4}"><div class="visual-ring"></div><div class="visual-core"></div><div class="data-card data-one"><small>Active signal</small><strong>${92 + (profileSeed(plan) % 7)}%</strong></div><div class="data-card data-two"><small>Momentum</small><strong>+${34 + index * 7}%</strong></div></div></header><section class="page-layout layout-${index % 4} section-shell" data-reveal><div class="page-copy"><span class="eyebrow">Built with purpose</span><h2>${escapeHtml(next.title)}</h2><p>${escapeHtml(next.body)}</p></div><div class="page-card-grid">${plan.features.slice(0, 6).map((feature, featureIndex) => `<article><span>${String(featureIndex + 1).padStart(2, '0')}</span><h3>${escapeHtml(titleCase(feature))}</h3><p>${escapeHtml(featureDescription(feature, plan.websiteType))}</p></article>`).join('')}</div></section></main>`;
}

function profileSeed(plan: WebsitePlan): number {
  return hashText(plan.businessName + plan.tagline);
}

function createPreviewHtml(plan: WebsitePlan, options: ProjectBuildOptions, profile: DesignProfile): string {
  const styles = createStyles(plan, profile);
  const pages = ensurePages(plan);
  const logo = encodeURIComponent(createLogoSvg(plan, profile));
  const pageHtml = pages.map((page, index) => page === 'home' ? renderHomePreview(plan, profile) : renderGenericPreview(plan, page, index)).join('');
  const nav = pages.map((page) => `<button data-route="${escapeHtml(page)}">${escapeHtml(titleCase(page))}</button>`).join('');
  const script = `<script>(function(){const pages=[...document.querySelectorAll('[data-page]')];const nav=[...document.querySelectorAll('[data-route]')];function show(){const route=(location.hash.replace(/^#\\/?/,'')||'home').toLowerCase();pages.forEach(p=>p.hidden=p.dataset.page!==route);nav.forEach(b=>b.classList.toggle('active',b.dataset.route===route));scrollTo(0,0)}nav.forEach(b=>b.addEventListener('click',()=>location.hash='#/'+b.dataset.route));addEventListener('hashchange',show);document.querySelectorAll('.faq-list article button').forEach((b)=>b.addEventListener('click',()=>b.closest('article').classList.toggle('open')));document.querySelectorAll('.lead-form').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();const s=f.querySelector('.form-status');if(s)s.textContent='Your enquiry is ready to connect.'}));const observer=new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting&&e.target.classList.add('is-visible')),{threshold:.1});document.querySelectorAll('[data-reveal]').forEach(e=>observer.observe(e));show()})()</script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(plan.businessName)}</title><meta name="description" content="${escapeHtml(plan.tagline)}"><style>${styles}</style></head><body><div class="site profile-${profile.key}"><div class="ambient ambient-one"></div><div class="ambient ambient-two"></div><div class="grid-overlay"></div><nav class="navigation"><button class="brand" data-route="home"><img src="data:image/svg+xml,${logo}" alt=""><span>${escapeHtml(plan.businessName)}</span></button><div class="nav-links">${nav}</div><button class="nav-cta" data-route="contact">Get started <span>↗</span></button></nav>${pageHtml}<footer class="footer section-shell"><div><button class="brand footer-brand" data-route="home"><img src="data:image/svg+xml,${logo}" alt=""><span>${escapeHtml(plan.businessName)}</span></button><p>${escapeHtml(plan.tagline)}</p></div><div class="footer-pages">${nav}</div><small>© ${new Date().getFullYear()} ${escapeHtml(plan.businessName)} · Made by Poojak Doshi</small></footer></div>${script}</body></html>`;
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
        version: '2.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { '@vitejs/plugin-react': '^4.6.0', vite: '^7.0.4', react: '^19.1.0', 'react-dom': '^19.1.0' },
        devDependencies: {}
      }, null, 2)
    },
    { path: 'index.html', content: `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><meta name="description" content="${escapeHtml(plan.tagline)}"/><meta property="og:title" content="${escapeHtml(plan.businessName)}"/><meta property="og:description" content="${escapeHtml(plan.tagline)}"/><meta name="theme-color" content="${safeColour(plan.theme.background, '#070914')}"/><link rel="icon" href="/logo.svg"/><title>${escapeHtml(plan.businessName)}</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>` },
    { path: 'src/main.jsx', content: `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App.jsx';\n\nReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);\n` },
    { path: 'src/App.jsx', content: createAppSource(plan, options, profile) },
    { path: 'src/styles.css', content: createStyles(plan, profile) },
    { path: 'public/logo.svg', content: createLogoSvg(plan, profile) },
    { path: 'vite.config.js', content: `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()], build: { cssCodeSplit: true } });\n` },
    { path: 'vercel.json', content: JSON.stringify({ framework: 'vite', buildCommand: 'npm run build', outputDirectory: 'dist', rewrites: [{ source: '/(.*)', destination: '/' }] }, null, 2) },
    { path: 'README.md', content: `# ${plan.businessName}\n\nPremium animated multi-page website generated by Nexora AI.\n\n## Run\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nGenerated with the Nexora Ultimate SaaS Engine.\n` }
  ];
  return { files, previewHtml: createPreviewHtml(plan, options, profile), framework: 'vite-react' };
}

export function renderPreviewHtml(plan: WebsitePlan, options: ProjectBuildOptions = {}): string {
  return createPreviewHtml(plan, options, chooseProfile(plan));
}

export function projectSlug(plan: WebsitePlan): string {
  return slugify(plan.businessName);
}
