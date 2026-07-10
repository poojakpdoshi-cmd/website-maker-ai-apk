import type { WebsitePlan } from '../../shared/src/index';

type Options = { apiKey?: string; model?: string };
export type BrainMode = 'ai' | 'built-in';

const colours: Record<string, [string, string, string, string]> = {
  jewellery: ['#d4af37', '#f5e4a7', '#090909', '#fffaf0'],
  fashion: ['#8b1e4f', '#f2b5d4', '#fff7fb', '#25141d'],
  tuition: ['#2563eb', '#14b8a6', '#f8fbff', '#14213d'],
  restaurant: ['#b45309', '#dc2626', '#fff8ef', '#2d1608'],
  portfolio: ['#7c3aed', '#06b6d4', '#090b16', '#f8f9ff'],
  business: ['#3155d9', '#13b8a6', '#f7f9ff', '#16203a']
};

const hexColour = /^#[0-9a-f]{6}$/i;

function cleanText(value: unknown, fallback: string, max = 160): string {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : fallback;
}

function cleanOptionalText(value: unknown, max = 180): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

function cleanList(value: unknown, fallback: string[], max = 10): string[] {
  if (!Array.isArray(value)) return fallback;
  const list = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-'))
    .filter(Boolean)
    .slice(0, max);
  return list.length ? [...new Set(list)] : fallback;
}

function extractContact(prompt: string) {
  const email = prompt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phoneMatch = prompt.match(/(?:\+?\d[\d\s()-]{8,}\d)/);
  const phone = phoneMatch?.[0]?.replace(/\s+/g, ' ').trim();
  const addressMatch = prompt.match(/(?:address|location)\s*[:\-]?\s*([^.;\n]{5,160})/i);
  return { email, phone, address: addressMatch?.[1]?.trim() };
}

function builtInPlan(prompt: string): WebsitePlan {
  const lower = prompt.toLowerCase();
  const type = ['jewellery', 'fashion', 'tuition', 'restaurant', 'portfolio'].find((item) => lower.includes(item)) || 'business';
  const [primary, secondary, background, text] = colours[type];
  const calledMatch = prompt.match(/(?:named|called)\s+([^,.]{2,60})/i);
  const forMatch = prompt.match(/\bfor\s+([^,.]{2,60})/i);
  const rawName = calledMatch?.[1] || forMatch?.[1];
  const businessName = rawName?.replace(/\s+(with|and|that|which|who)\b.*$/i, '').trim() || `${type[0].toUpperCase()}${type.slice(1)} Studio`;
  const features = ['responsive-design', 'seo', 'auto-branding'];
  if (lower.includes('whatsapp')) features.push('whatsapp');
  if (lower.includes('form') || lower.includes('enquiry') || lower.includes('contact')) features.push('contact-form');
  if (lower.includes('gallery') || lower.includes('products')) features.push('gallery');
  if (lower.includes('admin')) features.push('admin-panel');
  if (lower.includes('booking')) features.push('booking');
  const pages = ['home', 'about', lower.includes('product') ? 'products' : 'services'];
  if (lower.includes('pricing')) pages.push('pricing');
  pages.push('contact');
  return {
    businessName,
    websiteType: type,
    tagline: `A modern digital experience for ${businessName}`,
    pages,
    features: [...new Set(features)],
    theme: { style: lower.includes('premium') ? 'premium modern' : 'clean modern', primary, secondary, background, text },
    sections: [
      { title: `Welcome to ${businessName}`, body: 'A polished, mobile-first experience designed to build trust and turn visitors into customers.' },
      { title: 'What we offer', body: 'Present the strongest products, services and benefits with clear information and focused calls to action.' },
      { title: 'Built for trust', body: 'Fast loading, responsive layouts, search-friendly structure and accessible design across modern devices.' },
      ...(lower.includes('pricing') ? [{ title: 'Simple pricing', body: 'Present clear packages and help visitors choose the right option for their needs.' }] : []),
      { title: 'Contact us', body: 'Make it easy for visitors to contact the business, ask questions and submit an enquiry.' }
    ].slice(0, 6),
    contact: extractContact(prompt)
  };
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI did not return JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

function normalisePlan(raw: unknown, fallback: WebsitePlan): WebsitePlan {
  if (!raw || typeof raw !== 'object') return fallback;
  const candidate = raw as Record<string, unknown>;
  const rawTheme = candidate.theme && typeof candidate.theme === 'object' ? candidate.theme as Record<string, unknown> : {};
  const rawContact = candidate.contact && typeof candidate.contact === 'object' ? candidate.contact as Record<string, unknown> : {};
  const rawSections = Array.isArray(candidate.sections) ? candidate.sections : [];
  const sections = rawSections
    .filter((section): section is Record<string, unknown> => Boolean(section) && typeof section === 'object')
    .map((section) => ({
      title: cleanText(section.title, 'Website section', 80),
      body: cleanText(section.body, 'Add useful information about this business here.', 420)
    }))
    .slice(0, 7);

  return {
    businessName: cleanText(candidate.businessName, fallback.businessName, 60),
    websiteType: cleanText(candidate.websiteType, fallback.websiteType, 40).toLowerCase(),
    tagline: cleanText(candidate.tagline, fallback.tagline, 180),
    pages: cleanList(candidate.pages, fallback.pages, 9),
    features: cleanList(candidate.features, fallback.features, 14),
    theme: {
      style: cleanText(rawTheme.style, fallback.theme.style, 60),
      primary: typeof rawTheme.primary === 'string' && hexColour.test(rawTheme.primary) ? rawTheme.primary : fallback.theme.primary,
      secondary: typeof rawTheme.secondary === 'string' && hexColour.test(rawTheme.secondary) ? rawTheme.secondary : fallback.theme.secondary,
      background: typeof rawTheme.background === 'string' && hexColour.test(rawTheme.background) ? rawTheme.background : fallback.theme.background,
      text: typeof rawTheme.text === 'string' && hexColour.test(rawTheme.text) ? rawTheme.text : fallback.theme.text
    },
    sections: sections.length >= 3 ? sections : fallback.sections,
    contact: {
      phone: cleanOptionalText(rawContact.phone, 40) || fallback.contact?.phone,
      email: cleanOptionalText(rawContact.email, 160) || fallback.contact?.email,
      address: cleanOptionalText(rawContact.address, 180) || fallback.contact?.address
    }
  };
}

async function callGemini(instruction: string, options: Options): Promise<unknown> {
  if (!options.apiKey || !options.model) throw new Error('AI API is not configured.');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(options.apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: instruction }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.35 }
    })
  });
  if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty AI response.');
  return extractJson(text);
}

export async function buildWebsitePlan(prompt: string, options: Options): Promise<{ plan: WebsitePlan; mode: BrainMode }> {
  const fallback = builtInPlan(prompt);
  if (!options.apiKey || !options.model) return { plan: fallback, mode: 'built-in' };
  try {
    const instruction = `You are the planning brain for Website Maker AI. Return JSON only with keys businessName, websiteType, tagline, pages, features, theme, sections and contact. theme must contain style, primary, secondary, background and text as six-digit hex colours. sections must be an array of three to seven objects with title and body. contact can contain phone, email and address only when the user supplied them. Include contact-form in features when a form is requested. Keep content professional and concise. User request: ${prompt}`;
    return { plan: normalisePlan(await callGemini(instruction, options), fallback), mode: 'ai' };
  } catch (error) {
    console.error('Built-in brain used:', error);
    return { plan: fallback, mode: 'built-in' };
  }
}

function builtInRevision(current: WebsitePlan, instruction: string): WebsitePlan {
  const next: WebsitePlan = JSON.parse(JSON.stringify(current)) as WebsitePlan;
  const lower = instruction.toLowerCase();
  const colourMap: Array<[string, string, string]> = [
    ['blue', '#2563eb', '#06b6d4'], ['green', '#16a34a', '#14b8a6'], ['red', '#dc2626', '#f97316'],
    ['purple', '#7c3aed', '#ec4899'], ['gold', '#d4af37', '#f5e4a7'], ['pink', '#db2777', '#f9a8d4']
  ];
  const chosen = colourMap.find(([name]) => lower.includes(name));
  if (chosen) { next.theme.primary = chosen[1]; next.theme.secondary = chosen[2]; }
  if (lower.includes('dark')) { next.theme.background = '#090b12'; next.theme.text = '#f7f8ff'; }
  if (lower.includes('white') || lower.includes('light')) { next.theme.background = '#f8fafc'; next.theme.text = '#172033'; }
  if (lower.includes('premium')) next.theme.style = 'premium modern';
  if (lower.includes('minimal')) next.theme.style = 'minimal modern';
  if (lower.includes('add pricing') && !next.pages.includes('pricing')) {
    next.pages.splice(Math.max(1, next.pages.length - 1), 0, 'pricing');
    next.sections.push({ title: 'Clear pricing', body: 'Show simple packages and make it easy for visitors to select the right option.' });
  }
  if (lower.includes('remove pricing')) {
    next.pages = next.pages.filter((page) => page !== 'pricing');
    next.sections = next.sections.filter((section) => !/pricing/i.test(section.title));
  }
  if (lower.includes('add gallery') && !next.features.includes('gallery')) next.features.push('gallery');
  if (lower.includes('remove gallery')) next.features = next.features.filter((feature) => feature !== 'gallery');
  if ((lower.includes('add form') || lower.includes('contact form')) && !next.features.includes('contact-form')) next.features.push('contact-form');
  if (lower.includes('remove form')) next.features = next.features.filter((feature) => feature !== 'contact-form');
  const contact = extractContact(instruction);
  next.contact = { ...next.contact, ...Object.fromEntries(Object.entries(contact).filter(([, value]) => Boolean(value))) };
  return next;
}

export async function reviseWebsitePlan(current: WebsitePlan, instruction: string, options: Options): Promise<{ plan: WebsitePlan; mode: BrainMode }> {
  const fallback = builtInRevision(current, instruction);
  if (!options.apiKey || !options.model) return { plan: fallback, mode: 'built-in' };
  try {
    const prompt = `You edit an existing website plan. Return the complete updated plan as JSON only. Keep the same JSON shape and preserve details not affected by the instruction. Existing plan: ${JSON.stringify(current)}. Edit instruction: ${instruction}`;
    return { plan: normalisePlan(await callGemini(prompt, options), fallback), mode: 'ai' };
  } catch (error) {
    console.error('Built-in editor used:', error);
    return { plan: fallback, mode: 'built-in' };
  }
}
