import type { WebsitePlan } from '../../shared/src/index';

type Options = { apiKey?: string; model?: string; image?: { mimeType: string; data: string } };
export type BrainMode = 'ai' | 'built-in';

const colours: Record<string, [string, string, string, string]> = {
  jewellery: ['#d4af37', '#f5e4a7', '#080808', '#fffaf0'],
  fashion: ['#b4236b', '#ff9ac8', '#fff7fb', '#24131c'],
  tuition: ['#2563eb', '#14b8a6', '#f8fbff', '#14213d'],
  restaurant: ['#c65d16', '#d4a017', '#fff8ef', '#2d1608'],
  portfolio: ['#7c3aed', '#06b6d4', '#090b16', '#f8f9ff'],
  ecommerce: ['#111827', '#f97316', '#f8fafc', '#111827'],
  realestate: ['#0f766e', '#d4af37', '#f6fbfa', '#12221f'],
  healthcare: ['#0f6f8f', '#38bdf8', '#f5fbfd', '#12313d'],
  fitness: ['#dc2626', '#f59e0b', '#0b0b0c', '#fff7ed'],
  beauty: ['#a855f7', '#f9a8d4', '#fff8fc', '#2b1631'],
  travel: ['#0284c7', '#22c55e', '#f4fbff', '#102a43'],
  technology: ['#4f46e5', '#22d3ee', '#070a14', '#f8fbff'],
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

function cleanList(value: unknown, fallback: string[], max = 14): string[] {
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

function detectType(lower: string): string {
  const groups: Array<[string, string[]]> = [
    ['jewellery', ['jewellery', 'jewelry', 'diamond', 'gold shop', 'jewels']],
    ['fashion', ['fashion', 'boutique', 'clothing', 'saree', 'lehenga', 'apparel']],
    ['tuition', ['tuition', 'school', 'academy', 'coaching', 'education', 'classes']],
    ['restaurant', ['restaurant', 'cafe', 'food', 'bakery', 'kitchen', 'dining']],
    ['portfolio', ['portfolio', 'photographer', 'designer', 'developer', 'artist']],
    ['ecommerce', ['ecommerce', 'e-commerce', 'online store', 'shop', 'products']],
    ['realestate', ['real estate', 'property', 'realtor', 'builder', 'apartments']],
    ['healthcare', ['hospital', 'clinic', 'doctor', 'medical', 'healthcare', 'dentist']],
    ['fitness', ['gym', 'fitness', 'workout', 'trainer', 'yoga']],
    ['beauty', ['salon', 'beauty', 'makeup', 'spa', 'skincare']],
    ['travel', ['travel', 'tour', 'hotel', 'resort', 'trip', 'holiday']],
    ['technology', ['technology', 'tech', 'software', 'saas', 'ai ', 'startup', 'cyber']]
  ];
  return groups.find(([, words]) => words.some((word) => lower.includes(word)))?.[0] || 'business';
}

function detectStyle(lower: string, type: string): string {
  if (/(cyberpunk|neon|gaming|futuristic)/.test(lower)) return 'cyberpunk immersive';
  if (/(glass|glassmorphism|transparent)/.test(lower)) return 'glassmorphism premium';
  if (/(editorial|magazine|bold typography)/.test(lower)) return 'editorial statement';
  if (/(playful|colorful|colourful|kids|fun)/.test(lower)) return 'playful expressive';
  if (/(organic|natural|earthy|eco)/.test(lower)) return 'organic calm';
  if (/(minimal|minimalist|clean)/.test(lower)) return 'minimal refined';
  if (/(luxury|premium|royal|elegant)/.test(lower) || ['jewellery', 'fashion', 'beauty', 'realestate'].includes(type)) return 'luxury cinematic';
  if (type === 'technology') return 'futuristic glass';
  if (type === 'portfolio') return 'editorial creative';
  if (type === 'ecommerce') return 'conversion commerce';
  return 'modern professional';
}

function sectionLibrary(type: string, businessName: string): Array<{ title: string; body: string }> {
  const libraries: Record<string, Array<{ title: string; body: string }>> = {
    jewellery: [
      { title: 'Crafted to become an heirloom', body: `Introduce ${businessName} with a cinematic story about craftsmanship, detail and timeless value.` },
      { title: 'Signature collections', body: 'Showcase bridal, festive and everyday collections with confident product storytelling and premium presentation.' },
      { title: 'Made around your story', body: 'Explain customisation, consultations and the personal service behind every important purchase.' },
      { title: 'Trust in every detail', body: 'Highlight authenticity, quality standards, transparent guidance and long-term customer care.' },
      { title: 'Visit the showroom', body: 'Make location, timings, WhatsApp enquiries and appointment booking effortless.' }
    ],
    fashion: [
      { title: 'A new mood for every occasion', body: `Position ${businessName} as a distinctive fashion destination with a memorable visual identity.` },
      { title: 'Shop the latest edit', body: 'Present new arrivals, signature categories and seasonal highlights in an editorial layout.' },
      { title: 'Designed for real moments', body: 'Connect products to celebrations, work, travel and everyday personal style.' },
      { title: 'Loved by the community', body: 'Use testimonials, social proof and customer photographs to build confidence.' },
      { title: 'Find your perfect look', body: 'Guide visitors toward WhatsApp, store visits, enquiries or online shopping.' }
    ],
    tuition: [
      { title: 'Learning with a clear direction', body: `Explain how ${businessName} helps students understand concepts, stay consistent and improve outcomes.` },
      { title: 'Programs built for progress', body: 'Present standards, subjects, boards, batches and learning formats with clear choices.' },
      { title: 'A smarter learning system', body: 'Highlight tests, notes, attendance, feedback and parent communication.' },
      { title: 'Results backed by support', body: 'Share achievements, teaching approach and student success stories without exaggerated claims.' },
      { title: 'Book a counselling session', body: 'Make admissions, batch enquiries and trial-class booking simple.' }
    ],
    restaurant: [
      { title: 'A place worth arriving hungry for', body: `Create appetite and atmosphere for ${businessName} through a strong culinary story.` },
      { title: 'Explore the menu', body: 'Organise signature dishes, favourites and seasonal specials with clear visual hierarchy.' },
      { title: 'Made fresh, served with character', body: 'Show ingredients, preparation philosophy and what makes the experience different.' },
      { title: 'Moments around the table', body: 'Feature ambience, celebrations, reviews and social proof.' },
      { title: 'Reserve or order', body: 'Make booking, directions, delivery and WhatsApp ordering easy to access.' }
    ],
    portfolio: [
      { title: 'Selected work with a point of view', body: `Give ${businessName} a bold opening statement that feels personal, confident and memorable.` },
      { title: 'Featured projects', body: 'Showcase a curated body of work with context, outcomes and visual rhythm.' },
      { title: 'Process behind the work', body: 'Explain discovery, thinking, execution and collaboration in a clear way.' },
      { title: 'Capabilities', body: 'Present services and strengths without turning the site into a generic list.' },
      { title: 'Start a project', body: 'Invite relevant enquiries with a focused contact experience.' }
    ],
    ecommerce: [
      { title: 'Discover what is worth adding to cart', body: `Introduce ${businessName} with a campaign-style hero and clear shopping paths.` },
      { title: 'Shop by category', body: 'Create fast discovery through category cards, featured products and curated collections.' },
      { title: 'Why customers choose us', body: 'Highlight quality, delivery, returns, support and other real purchase advantages.' },
      { title: 'Trending now', body: 'Use product storytelling, offers and social proof to increase confidence.' },
      { title: 'A smoother way to shop', body: 'Keep search, product actions, WhatsApp and checkout-related calls to action easy to find.' }
    ],
    realestate: [
      { title: 'Find a place that feels right', body: `Position ${businessName} with premium property storytelling and local credibility.` },
      { title: 'Featured properties', body: 'Present selected listings with location, key details and enquiry actions.' },
      { title: 'Expertise across every move', body: 'Explain buying, selling, renting or investment support with clarity.' },
      { title: 'Know the neighbourhood', body: 'Add location insights, connectivity and lifestyle context.' },
      { title: 'Schedule a private viewing', body: 'Make property enquiries and appointments frictionless.' }
    ],
    healthcare: [
      { title: 'Care that begins with listening', body: `Introduce ${businessName} with a reassuring, trustworthy and accessible experience.` },
      { title: 'Services and specialities', body: 'Help visitors quickly understand treatments, departments or consultation options.' },
      { title: 'Meet the care team', body: 'Present qualifications, experience and approach in a human way.' },
      { title: 'What patients can expect', body: 'Explain the appointment journey, facilities and support clearly.' },
      { title: 'Book an appointment', body: 'Make calling, messaging, location and appointment requests easy.' }
    ],
    fitness: [
      { title: 'Train with purpose', body: `Give ${businessName} an energetic opening focused on progress, confidence and consistency.` },
      { title: 'Programs for every goal', body: 'Present training formats, memberships and coaching paths clearly.' },
      { title: 'The experience inside', body: 'Show equipment, trainers, community and facilities.' },
      { title: 'Real progress stories', body: 'Use responsible testimonials and measurable achievements.' },
      { title: 'Start your first session', body: 'Guide visitors toward trials, memberships and consultations.' }
    ],
    beauty: [
      { title: 'Your ritual, elevated', body: `Introduce ${businessName} with an elegant beauty story and refined visual direction.` },
      { title: 'Treatments and services', body: 'Organise services by need, occasion or result with clear details.' },
      { title: 'Expert hands, thoughtful care', body: 'Present experience, products and hygiene standards with confidence.' },
      { title: 'The signature experience', body: 'Use ambience, reviews and transformations to build trust.' },
      { title: 'Reserve your appointment', body: 'Make booking and WhatsApp enquiries simple.' }
    ],
    travel: [
      { title: 'Go somewhere unforgettable', body: `Open ${businessName} with destination-led storytelling and a strong sense of possibility.` },
      { title: 'Popular journeys', body: 'Present packages, destinations and experiences with scannable information.' },
      { title: 'Travel planned around you', body: 'Explain custom itineraries, support and booking assistance.' },
      { title: 'Stories from the road', body: 'Add reviews, photographs and useful destination inspiration.' },
      { title: 'Plan your trip', body: 'Create a direct enquiry path for dates, travellers and preferences.' }
    ],
    technology: [
      { title: 'A sharper way to solve the problem', body: `Position ${businessName} as a focused technology product with a clear outcome.` },
      { title: 'See how it works', body: 'Explain the workflow with visual steps, product views or feature demonstrations.' },
      { title: 'Built for meaningful impact', body: 'Connect capabilities to practical benefits and measurable value.' },
      { title: 'Reliable by design', body: 'Highlight security, performance, integrations and support where relevant.' },
      { title: 'Start building with us', body: 'Guide visitors to a demo, trial, contact or onboarding action.' }
    ],
    business: [
      { title: 'A clearer reason to choose us', body: `Introduce ${businessName} with a confident value proposition instead of generic marketing copy.` },
      { title: 'What we do best', body: 'Present the strongest services or solutions with clear outcomes.' },
      { title: 'How the work happens', body: 'Show a simple process that reduces uncertainty for potential customers.' },
      { title: 'Proof that builds trust', body: 'Use relevant results, testimonials, credentials or client stories.' },
      { title: 'Let us discuss the next step', body: 'Create a direct contact path with clear expectations.' }
    ]
  };
  return libraries[type] || libraries.business;
}

function builtInPlan(prompt: string): WebsitePlan {
  const lower = prompt.toLowerCase();
  const type = detectType(lower);
  const [primary, secondary, background, text] = colours[type] || colours.business;
  const calledMatch = prompt.match(/(?:named|called)\s+([^,.]{2,60})/i);
  const forMatch = prompt.match(/\bfor\s+([^,.]{2,60})/i);
  const rawName = calledMatch?.[1] || forMatch?.[1];
  const businessName = rawName?.replace(/\s+(with|and|that|which|who)\b.*$/i, '').trim() || `${type[0].toUpperCase()}${type.slice(1)} Studio`;
  const style = detectStyle(lower, type);

  const features = ['responsive-design', 'seo', 'custom-branding', 'smooth-animations'];
  if (lower.includes('whatsapp')) features.push('whatsapp');
  if (/(form|enquiry|contact|lead)/.test(lower)) features.push('contact-form');
  if (/(gallery|photos|portfolio|products|collections)/.test(lower)) features.push('gallery');
  if (/(shop|store|cart|ecommerce|e-commerce)/.test(lower)) features.push('product-catalogue');
  if (/(booking|appointment|reserve)/.test(lower)) features.push('booking');
  if (/(testimonial|review)/.test(lower)) features.push('testimonials');
  if (lower.includes('faq')) features.push('faq');
  if (lower.includes('pricing')) features.push('pricing');
  if (/(map|location|directions)/.test(lower)) features.push('map');
  if (lower.includes('admin')) features.push('admin-panel');

  const pageSets: Record<string, string[]> = {
    jewellery: ['home', 'collections', 'craftsmanship', 'about', 'contact'],
    fashion: ['home', 'new-arrivals', 'collections', 'about', 'contact'],
    tuition: ['home', 'programs', 'results', 'about', 'contact'],
    restaurant: ['home', 'menu', 'experience', 'about', 'contact'],
    portfolio: ['home', 'work', 'services', 'about', 'contact'],
    ecommerce: ['home', 'shop', 'collections', 'about', 'contact'],
    realestate: ['home', 'properties', 'services', 'about', 'contact'],
    healthcare: ['home', 'services', 'team', 'about', 'contact'],
    fitness: ['home', 'programs', 'trainers', 'about', 'contact'],
    beauty: ['home', 'services', 'experience', 'about', 'contact'],
    travel: ['home', 'destinations', 'packages', 'about', 'contact'],
    technology: ['home', 'product', 'solutions', 'about', 'contact'],
    business: ['home', 'services', 'process', 'about', 'contact']
  };
  const pages = [...(pageSets[type] || pageSets.business)];
  if (lower.includes('pricing') && !pages.includes('pricing')) pages.splice(pages.length - 1, 0, 'pricing');

  return {
    businessName,
    websiteType: type,
    tagline: `A distinctive digital experience created for ${businessName}`,
    pages,
    features: [...new Set(features)],
    theme: { style, primary, secondary, background, text },
    sections: sectionLibrary(type, businessName).slice(0, 7),
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
      title: cleanText(section.title, 'Website section', 90),
      body: cleanText(section.body, 'Add useful information about this business here.', 520)
    }))
    .slice(0, 10);

  return {
    businessName: cleanText(candidate.businessName, fallback.businessName, 60),
    websiteType: cleanText(candidate.websiteType, fallback.websiteType, 40).toLowerCase(),
    tagline: cleanText(candidate.tagline, fallback.tagline, 180),
    pages: cleanList(candidate.pages, fallback.pages, 10),
    features: cleanList(candidate.features, fallback.features, 16),
    theme: {
      style: cleanText(rawTheme.style, fallback.theme.style, 60),
      primary: typeof rawTheme.primary === 'string' && hexColour.test(rawTheme.primary) ? rawTheme.primary : fallback.theme.primary,
      secondary: typeof rawTheme.secondary === 'string' && hexColour.test(rawTheme.secondary) ? rawTheme.secondary : fallback.theme.secondary,
      background: typeof rawTheme.background === 'string' && hexColour.test(rawTheme.background) ? rawTheme.background : fallback.theme.background,
      text: typeof rawTheme.text === 'string' && hexColour.test(rawTheme.text) ? rawTheme.text : fallback.theme.text
    },
    sections: sections.length >= 5 ? sections : fallback.sections,
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
      generationConfig: { responseMimeType: 'application/json', temperature: 0.72 }
    })
  });
  if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty AI response.');
  return extractJson(text);
}

const DESIGN_DIRECTOR_RULES = `
Act as Nexora AI's senior product strategist, conversion copywriter and award-level digital design director.
Study the user's industry, audience, business model, product maturity, requested features, tone and visual references before planning.
Never produce a generic template plan. Every response must feel written for this exact business and this exact request.
Create a real multi-page information architecture with five to eight useful pages. Pages must have distinct purposes, not duplicated content.
Write six to ten substantial sections. Each section body must contain specific customer-facing copy, not instructions such as "showcase", "explain", "add" or "highlight".
Create a memorable hero promise, one clear primary call to action, one secondary action, measurable trust signals, product proof, objections, testimonials, pricing or conversion content when relevant.
Avoid empty claims such as innovative, cutting-edge, world-class or best-in-class unless the request provides evidence.
Choose a coherent visual direction that fits the market: aurora intelligence, orbital product system, editorial technology, monolithic precision, immersive glass, conversion commerce, expressive launch or human technology.
Vary the page structure, section rhythm, hierarchy and visual emphasis between unrelated requests.
Use a deliberate four-colour palette with accessible contrast. All colours must be six-digit hex values.
Only include useful features. Prefer practical actions such as demo, trial, enquiry, WhatsApp, booking, catalogue, gallery, testimonials, FAQ, integrations, pricing or map when relevant.
Pages must be concise slugs. contact may contain only phone, email and address explicitly supplied by the user.
Return valid JSON only with exactly these top-level keys: businessName, websiteType, tagline, pages, features, theme, sections, contact.
theme must contain style, primary, secondary, background and text.
sections must contain title and body.
`;

export async function buildWebsitePlan(prompt: string, options: Options): Promise<{ plan: WebsitePlan; mode: BrainMode }> {
  const fallback = builtInPlan(prompt);
  if (!options.apiKey || !options.model) return { plan: fallback, mode: 'built-in' };
  try {
    const instruction = `${DESIGN_DIRECTOR_RULES}\nUser request:\n${prompt}`;
    return { plan: normalisePlan(await callGemini(instruction, options), fallback), mode: 'ai' };
  } catch (error) {
    console.error('Nexora built-in Design Director used:', error);
    return { plan: fallback, mode: 'built-in' };
  }
}

function builtInRevision(current: WebsitePlan, instruction: string): WebsitePlan {
  const next: WebsitePlan = JSON.parse(JSON.stringify(current)) as WebsitePlan;
  const lower = instruction.toLowerCase();
  const colourMap: Array<[string, string, string]> = [
    ['blue', '#2563eb', '#06b6d4'], ['green', '#16a34a', '#14b8a6'], ['red', '#dc2626', '#f97316'],
    ['purple', '#7c3aed', '#ec4899'], ['gold', '#d4af37', '#f5e4a7'], ['pink', '#db2777', '#f9a8d4'],
    ['orange', '#ea580c', '#f59e0b'], ['black', '#111111', '#6b7280']
  ];
  const chosen = colourMap.find(([name]) => lower.includes(name));
  if (chosen) { next.theme.primary = chosen[1]; next.theme.secondary = chosen[2]; }
  if (lower.includes('dark')) { next.theme.background = '#090b12'; next.theme.text = '#f7f8ff'; }
  if (lower.includes('white') || lower.includes('light')) { next.theme.background = '#f8fafc'; next.theme.text = '#172033'; }
  if (lower.includes('luxury')) next.theme.style = 'luxury cinematic';
  if (lower.includes('premium')) next.theme.style = 'premium refined';
  if (lower.includes('minimal')) next.theme.style = 'minimal refined';
  if (lower.includes('editorial')) next.theme.style = 'editorial statement';
  if (lower.includes('glass')) next.theme.style = 'futuristic glass';
  if (lower.includes('playful')) next.theme.style = 'playful expressive';
  if (lower.includes('add pricing') && !next.pages.includes('pricing')) {
    next.pages.splice(Math.max(1, next.pages.length - 1), 0, 'pricing');
    next.sections.push({ title: 'Choose the right option', body: 'Present clear packages with meaningful differences and a direct next step.' });
  }
  if (lower.includes('remove pricing')) {
    next.pages = next.pages.filter((page) => page !== 'pricing');
    next.sections = next.sections.filter((section) => !/pricing|package|option/i.test(section.title));
  }
  if (lower.includes('add gallery') && !next.features.includes('gallery')) next.features.push('gallery');
  if (lower.includes('remove gallery')) next.features = next.features.filter((feature) => feature !== 'gallery');
  if ((lower.includes('add form') || lower.includes('contact form')) && !next.features.includes('contact-form')) next.features.push('contact-form');
  if (lower.includes('remove form')) next.features = next.features.filter((feature) => feature !== 'contact-form');
  if (lower.includes('add testimonials') && !next.features.includes('testimonials')) next.features.push('testimonials');
  if (lower.includes('add faq') && !next.features.includes('faq')) next.features.push('faq');
  if ((lower.includes('add booking') || lower.includes('appointment')) && !next.features.includes('booking')) next.features.push('booking');
  const contact = extractContact(instruction);
  next.contact = { ...next.contact, ...Object.fromEntries(Object.entries(contact).filter(([, value]) => Boolean(value))) };
  return next;
}

export async function reviseWebsitePlan(current: WebsitePlan, instruction: string, options: Options): Promise<{ plan: WebsitePlan; mode: BrainMode }> {
  const fallback = builtInRevision(current, instruction);
  if (!options.apiKey || !options.model) return { plan: fallback, mode: 'built-in' };
  try {
    const prompt = `${DESIGN_DIRECTOR_RULES}
Edit the existing plan according to the user's instruction.
Preserve strong details that were not requested to change, but improve weak or repetitive content.
Return the complete updated plan as JSON only.
Existing plan:
${JSON.stringify(current)}
Edit instruction:
${instruction}`;
    return { plan: normalisePlan(await callGemini(prompt, options), fallback), mode: 'ai' };
  } catch (error) {
    console.error('Nexora built-in Design Director editor used:', error);
    return { plan: fallback, mode: 'built-in' };
  }
}
