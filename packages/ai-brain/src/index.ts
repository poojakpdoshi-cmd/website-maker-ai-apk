import type {
  ApplicationSpec,
  AppSpecCalculation,
  AppSpecEntity,
  AppSpecField,
  AppSpecScreen,
  ProjectKind,
  WebsitePlan
} from '../../shared/src/index';

type Options = { apiKey?: string; model?: string; image?: { mimeType: string; data: string } };
export type BrainMode = 'ai' | 'built-in';
export type WebsitePlanResult = {
  plan: WebsitePlan;
  mode: BrainMode;
  fallbackUsed: boolean;
  fallbackReason?: string;
};

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

const functionalKinds = new Set<ProjectKind>([
  'dashboard',
  'calculator',
  'crud_application',
  'admin_panel',
  'ecommerce_application',
  'booking_system',
  'management_system',
  'functional_application'
]);

function classifyProjectKind(prompt: string): ProjectKind {
  const lower = prompt.toLowerCase();
  if (/\badmin(?:istration)?\s*(?:panel|portal|dashboard|app)\b/.test(lower)) return 'admin_panel';
  if (/\bcalculator\b|\bcalculate\b|\bformula(?:s)?\b|\bcomputation\b/.test(lower)) return 'calculator';
  if (/\bcrud\b|create[,/ ]+read[,/ ]+update[,/ ]+delete|\badd[,/ ]+edit[,/ ]+delete\b/.test(lower)) return 'crud_application';
  if (/\bbooking\b|\breservation\b|\bappointment\s+(?:system|app|portal)\b/.test(lower)) return 'booking_system';
  if (/\b(?:inventory|school|hospital|hotel|employee|student|customer|project|task|warehouse)\s+management\b|\bmanagement\s+system\b/.test(lower)) return 'management_system';
  if (/\bdashboard\b|\banalytics\s+(?:app|portal|dashboard)\b/.test(lower)) return 'dashboard';
  if (/\be-?commerce\b|\bonline\s+store\b|\bshopping\s+(?:app|cart)\b|\bcheckout\b/.test(lower)) return 'ecommerce_application';
  if (/\bportfolio\b|\bcase\s+stud(?:y|ies)\b|\bselected\s+work\b/.test(lower)) return 'portfolio';
  if (/\b(?:web\s+)?application\b|\bweb\s+app\b|\bportal\b|\btool\b/.test(lower)) return 'functional_application';
  return 'marketing_website';
}

function keyFromLabel(value: string, fallback = 'field'): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || fallback;
}

function splitRequestedList(value: string): string[] {
  return value
    .replace(/\band\b/gi, ',')
    .split(/[,;|]/)
    .map((item) => item.replace(/^[\s:*-]+|[\s.]+$/g, '').trim())
    .filter((item) => item.length >= 1 && item.length <= 80)
    .slice(0, 30);
}

function inferFieldType(label: string): AppSpecField['type'] {
  const lower = label.toLowerCase();
  if (/email/.test(lower)) return 'email';
  if (/phone|mobile|whatsapp/.test(lower)) return 'phone';
  if (/url|link|website/.test(lower)) return 'url';
  if (/date|day/.test(lower)) return 'date';
  if (/time|created at|updated at/.test(lower)) return 'datetime';
  if (/price|amount|cost|revenue|salary|total|subtotal|tax|fee|balance/.test(lower)) return 'currency';
  if (/percent|percentage|rate|margin|discount/.test(lower)) return 'percentage';
  if (/count|quantity|qty|number|age|score|hours|days/.test(lower)) return 'number';
  if (/active|enabled|paid|complete|approved|verified/.test(lower)) return 'boolean';
  if (/description|notes|message|details|address/.test(lower)) return 'long_text';
  if (/status|category|type|role/.test(lower)) return 'select';
  return 'text';
}

function fieldsFromLabels(labels: string[]): AppSpecField[] {
  const seen = new Set<string>();
  return labels.flatMap((label) => {
    const key = keyFromLabel(label);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{
      key,
      label: label.trim(),
      type: inferFieldType(label),
      required: !/\boptional\b/i.test(label),
      validation: []
    } satisfies AppSpecField];
  });
}

function explicitLists(
  prompt: string,
  noun: 'columns?' | 'fields?' | 'screens?' | 'pages?' | 'filters?' | 'tables?'
): string[] {
  const expression = new RegExp(
    `(?:${noun})\\s*(?:are|include|including|with|:|-)\\s*([^\\n.]+)`,
    'gi'
  );
  const values: string[] = [];
  for (const match of prompt.matchAll(expression)) {
    values.push(...splitRequestedList(match[1] || ''));
  }
  return [...new Set(values)].slice(0, 30);
}

function extractCalculations(prompt: string): AppSpecCalculation[] {
  const calculations: AppSpecCalculation[] = [];
  const formulaPattern = /(?:formula\s*(?:for\s+)?)?([A-Za-z][A-Za-z0-9 _-]{1,50})\s*=\s*([^.;\n]{3,180})/gi;
  for (const match of prompt.matchAll(formulaPattern)) {
    const label = match[1]
      .replace(/^formula\s*(?:for\s+)?/i, '')
      .trim();
    const expression = match[2].trim();
    const outputField = keyFromLabel(label, 'result');
    const identifiers = [...expression.matchAll(/\b[A-Za-z][A-Za-z0-9_]*\b/g)]
      .map((item) => keyFromLabel(item[0]))
      .filter((item) => !['min', 'max', 'round', 'Math', 'true', 'false'].includes(item));
    calculations.push({
      key: outputField,
      label,
      expression,
      inputFields: [...new Set(identifiers)],
      outputField,
      dependencies: [...new Set(identifiers)]
    });
  }
  return calculations.slice(0, 20);
}

function reconcileCalculations(
  calculations: AppSpecCalculation[],
  fields: AppSpecField[]
): AppSpecCalculation[] {
  const orderedFields = [...fields].sort(
    (left, right) => right.label.length - left.label.length
  );
  return calculations.map((calculation) => {
    let expression = calculation.expression;
    for (const field of orderedFields) {
      const escaped = field.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expression = expression.replace(
        new RegExp(`\\b${escaped}\\b`, 'gi'),
        field.key
      );
    }
    const output = fields.find((field) =>
      normalizedPhrase(field.label) === normalizedPhrase(calculation.label) ||
      field.key === keyFromLabel(calculation.label)
    );
    const identifiers = [...expression.matchAll(/\b[A-Za-z][A-Za-z0-9_]*\b/g)]
      .map((item) => keyFromLabel(item[0]))
      .filter((item) =>
        fields.some((field) => field.key === item) &&
        item !== output?.key
      );
    const dependencies = [...new Set(identifiers)];
    return {
      ...calculation,
      key: output?.key || keyFromLabel(calculation.label, 'result'),
      expression,
      inputFields: dependencies,
      outputField: output?.key || keyFromLabel(calculation.label, 'result'),
      dependencies
    };
  });
}

function normalizedPhrase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function extractEntityDefinitions(prompt: string): Array<{
  name: string;
  fields: string[];
}> {
  const definitions: Array<{ name: string; fields: string[] }> = [];
  const patterns = [
    /(?:table|entity)\s+([A-Za-z][A-Za-z0-9 _-]{1,40})\s+(?:with\s+)?(?:columns|fields)\s*[:=-]\s*([^\n.;]+)/gi,
    /([A-Za-z][A-Za-z0-9 _-]{1,40})\s+table\s+(?:with\s+)?(?:columns|fields)\s*[:=-]\s*([^\n.;]+)/gi
  ];
  for (const pattern of patterns) {
    for (const match of prompt.matchAll(pattern)) {
      const name = match[1].trim();
      if (/^(?:column|field|screen|page)s?$/i.test(name)) continue;
      const fields = splitRequestedList(match[2] || '');
      if (!fields.length) continue;
      definitions.push({ name, fields });
    }
  }
  const byKey = new Map<string, { name: string; fields: string[] }>();
  for (const definition of definitions) {
    byKey.set(keyFromLabel(definition.name), definition);
  }
  return [...byKey.values()].slice(0, 12);
}

function inferredRelationships(
  prompt: string,
  entities: AppSpecEntity[]
): AppSpecEntity[] {
  const byPhrase = new Map(
    entities.flatMap((entity) => [
      [normalizedPhrase(entity.key), entity],
      [normalizedPhrase(entity.label), entity],
      [normalizedPhrase(entity.label.replace(/s$/i, '')), entity]
    ])
  );
  const relationPattern = /([A-Za-z][A-Za-z0-9 _-]{1,40})\s+(has\s+(?:one|many)|belongs\s+to|references?)\s+([A-Za-z][A-Za-z0-9 _-]{1,40})/gi;
  for (const match of prompt.matchAll(relationPattern)) {
    const source = byPhrase.get(normalizedPhrase(match[1]));
    const target = byPhrase.get(normalizedPhrase(match[3]));
    if (!source || !target || source.key === target.key) continue;
    const verb = match[2].toLowerCase();
    const type = verb.includes('many')
      ? 'one_to_many' as const
      : 'one_to_one' as const;
    if (!source.relationships.some((item) => item.targetEntity === target.key)) {
      source.relationships.push({ type, targetEntity: target.key });
    }
  }
  return entities;
}

function fallbackAppSpec(
  prompt: string,
  projectKind: ProjectKind,
  businessName: string,
  pages: string[]
): ApplicationSpec {
  const lower = prompt.toLowerCase();
  const requestedColumns = explicitLists(prompt, 'columns?');
  const requestedFields = explicitLists(prompt, 'fields?');
  const requestedScreens = explicitLists(prompt, 'screens?');
  const requestedTables = explicitLists(prompt, 'tables?');
  const requestedFilters = explicitLists(prompt, 'filters?');
  let calculations = extractCalculations(prompt);
  const needsCrud =
    /\bcrud\b|\bcreate\b|\badd\b|\bedit\b|\bupdate\b|\bdelete\b/.test(lower) ||
    ['crud_application', 'admin_panel', 'booking_system', 'management_system']
      .includes(projectKind);
  const search =
    /\bsearch\b/.test(lower) ||
    projectKind === 'ecommerce_application';
  const sorting = /\bsort(?:ing)?\b/.test(lower) ? ['user-selected sort'] : [];
  const exportActions = /\bexport\b/.test(lower)
    ? [/\bcsv\b/.test(lower) ? 'Export CSV' : 'Export data']
    : [];
  const modalActions = /\bmodal\b|\bdialog\b/.test(lower) ? ['Open requested modal'] : [];
  const labels = requestedColumns.length
    ? requestedColumns
    : requestedFields.length
      ? requestedFields
      : calculations.length
        ? [...new Set(calculations.flatMap((item) => [...item.inputFields, item.outputField]))]
        : ['Name', 'Status', 'Created at'];
  const fields = fieldsFromLabels(labels);
  calculations = reconcileCalculations(calculations, fields);
  const entityKey = projectKind === 'calculator'
    ? 'calculation'
    : keyFromLabel(
        prompt.match(/\b(?:manage|tracking|for)\s+(?:all\s+)?([A-Za-z][A-Za-z -]{2,40})/i)?.[1] ||
        businessName,
        'record'
      );
  const persistenceRequired =
    functionalKinds.has(projectKind) &&
    !/\bno\s+(?:backend|database|persistence)\b/.test(lower);
  const entityDefinitions = extractEntityDefinitions(prompt);
  const domainEntityDefinitions = projectKind === 'ecommerce_application'
    ? [
        {
          name: 'Products',
          fields: ['Name', 'Price', 'Description', 'Image URL', 'Stock']
        },
        {
          name: 'Orders',
          fields: ['Customer Email', 'Total', 'Status', 'Created at']
        }
      ]
    : projectKind === 'booking_system'
      ? [{
          name: 'Bookings',
          fields: ['Customer Name', 'Email', 'Phone', 'Booking Date', 'Time', 'Status', 'Notes']
        }]
      : projectKind === 'management_system'
        ? [{
            name: 'Records',
            fields: requestedColumns.length
              ? requestedColumns
              : ['Name', 'Status', 'Owner', 'Due Date', 'Notes']
          }]
        : [];
  const effectiveEntityDefinitions = entityDefinitions.length
    ? entityDefinitions
    : domainEntityDefinitions;
  const entities = inferredRelationships(
    prompt,
    (
      effectiveEntityDefinitions.length
        ? effectiveEntityDefinitions.map((definition) => ({
            key: keyFromLabel(definition.name),
            label: titleCase(definition.name),
            fields: fieldsFromLabels(definition.fields),
            relationships: [],
            persistence: persistenceRequired ? 'managed' as const : 'local' as const
          }))
        : requestedTables.length
          ? requestedTables.map((table, index) => ({
              key: keyFromLabel(table, `entity_${index + 1}`),
              label: titleCase(table),
              fields: index === 0 ? fields : fieldsFromLabels(['Name', 'Status', 'Created at']),
              relationships: [],
              persistence: persistenceRequired ? 'managed' as const : 'local' as const
            }))
          : [{
              key: entityKey,
              label: titleCase(entityKey),
              fields,
              relationships: [],
              persistence: persistenceRequired ? 'managed' as const : 'local' as const
            }]
    ) satisfies AppSpecEntity[]
  );
  const entity = entities[0];
  const actions = [
    ...(needsCrud ? ['Create', 'Edit', 'Delete', 'View'] : []),
    ...(projectKind === 'ecommerce_application'
      ? ['Add to cart', 'Checkout', 'Search', 'View']
      : []),
    ...(search ? ['Search'] : []),
    ...exportActions
  ];
  const screenNames = requestedScreens.length
    ? requestedScreens
    : functionalKinds.has(projectKind)
      ? projectKind === 'calculator'
        ? ['Calculator']
        : entities.map((item) => item.label)
      : pages.map(titleCase);
  const screens: AppSpecScreen[] = screenNames.map((title, index) => {
    const screenEntity = entities[index] || entities[0];
    return ({
    key: keyFromLabel(title, `screen_${index + 1}`),
    title,
    purpose: `Provide the requested ${title} experience.`,
    kind: projectKind === 'calculator'
      ? 'calculator'
      : projectKind === 'dashboard' || projectKind === 'admin_panel'
        ? index === 0 ? 'dashboard' : 'table'
        : projectKind === 'portfolio'
          ? 'portfolio'
          : functionalKinds.has(projectKind)
            ? 'table'
            : 'landing',
    entity: functionalKinds.has(projectKind) ? screenEntity.key : undefined,
    tableColumns: functionalKinds.has(projectKind)
      ? screenEntity.fields.map((field) => field.key)
      : [],
    formFields: needsCrud || projectKind === 'calculator'
      ? screenEntity.fields
          .filter((field) => !calculations.some((item) => item.outputField === field.key))
          .map((field) => field.key)
      : [],
    actions: projectKind === 'ecommerce_application'
      ? index === 0
        ? ['Add to cart', 'Checkout', 'Search', 'View']
        : ['View']
      : actions,
    filters: requestedFilters,
    search,
    sorting,
    modalActions,
    exportActions
  });
  });
  const acceptanceCriteria = prompt
    .split(/[\n.]+/)
    .map((item) => item.trim())
    .filter((item) => /\b(?:must|should|required|exact|when|cannot|can't|do not|without)\b/i.test(item))
    .slice(0, 30);

  return {
    schemaVersion: 1,
    projectKind,
    title: businessName,
    summary: prompt.replace(/\s+/g, ' ').trim().slice(0, 500),
    screens,
    entities: functionalKinds.has(projectKind) ? entities : [],
    calculations,
    globalActions: [...new Set(actions)],
    dataDependencies: calculations.flatMap((item) =>
      item.dependencies.map((dependency) => `${dependency} updates ${item.outputField}`)
    ),
    acceptanceCriteria: acceptanceCriteria.length
      ? acceptanceCriteria
      : [`The result must satisfy the complete user request: ${prompt.slice(0, 700)}`],
    persistenceRequired,
    realTimeRequired: /\breal[- ]?time\b|\blive updates?\b/.test(lower),
    responsiveRequirements: [
      'No horizontal overflow at 320px viewport width.',
      'All primary actions remain usable with touch and keyboard.'
    ],
    backend: {
      required: persistenceRequired,
      authentication: /\b(?:login|sign[ -]?in|authentication|user accounts?)\b/.test(lower)
        ? ['Authenticated users']
        : [],
      collections: persistenceRequired
        ? entities.map((item) => ({
            key: item.key,
            fields: item.fields,
            ownerScoped: true
          }))
        : [],
      indexes: entities.flatMap((item) =>
        requestedFilters.map((field) => ({
          collection: item.key,
          fields: [keyFromLabel(field)]
        }))
      ),
      storage: /\b(?:image|photo|file|upload|attachment)\b/.test(lower) ? ['uploads'] : [],
      functions: /\b(?:secure api|server-side|webhook|payment processing|send email|email notification)\b/.test(lower)
        ? ['secure application operations']
        : [],
      environmentVariables: persistenceRequired
        ? [
            'VITE_FIREBASE_API_KEY',
            'VITE_FIREBASE_AUTH_DOMAIN',
            'VITE_FIREBASE_PROJECT_ID',
            'VITE_FIREBASE_STORAGE_BUCKET',
            'VITE_FIREBASE_APP_ID'
          ]
        : []
    },
    forbiddenMarketingSections: functionalKinds.has(projectKind)
      ? ['pricing', 'testimonials', 'faq', 'saas hero']
      : []
  };
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
  const projectKind = classifyProjectKind(prompt);
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
    websiteType: projectKind === 'marketing_website' ? type : projectKind,
    tagline: `A distinctive digital experience created for ${businessName}`,
    pages,
    features: [...new Set(features)],
    theme: { style, primary, secondary, background, text },
    sections: sectionLibrary(type, businessName).slice(0, 7),
    contact: extractContact(prompt),
    appSpec: fallbackAppSpec(
      prompt,
      projectKind,
      businessName,
      pages
    )
  };
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI did not return JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

function cleanStringArray(value: unknown, fallback: string[] = [], max = 40): string[] {
  if (!Array.isArray(value)) return fallback;
  const values = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, max);
  return values.length ? [...new Set(values)] : fallback;
}

function cleanField(value: unknown): AppSpecField | null {
  if (!value || typeof value !== 'object') return null;
  const field = value as Record<string, unknown>;
  const label = cleanText(field.label, '', 80);
  const key = keyFromLabel(
    typeof field.key === 'string' ? field.key : label
  );
  if (!label || !key) return null;
  const allowedTypes = new Set<AppSpecField['type']>([
    'text', 'long_text', 'number', 'currency', 'percentage', 'boolean',
    'date', 'datetime', 'email', 'phone', 'url', 'select', 'reference'
  ]);
  const type = typeof field.type === 'string' &&
    allowedTypes.has(field.type as AppSpecField['type'])
    ? field.type as AppSpecField['type']
    : inferFieldType(label);
  return {
    key,
    label,
    type,
    required: field.required !== false,
    options: cleanStringArray(field.options, [], 30),
    validation: cleanStringArray(field.validation, [], 20),
    referenceEntity: cleanOptionalText(field.referenceEntity, 64)
  };
}

function mergeBindingRequirements(
  candidate: ApplicationSpec,
  fallback: ApplicationSpec
): ApplicationSpec {
  const entities = candidate.entities.map((entity) => ({
    ...entity,
    fields: [...entity.fields],
    relationships: [...entity.relationships]
  }));
  for (const required of fallback.entities) {
    const existing = entities.find((entity) => entity.key === required.key);
    if (!existing) {
      entities.push(required);
      continue;
    }
    for (const field of required.fields) {
      if (!existing.fields.some((item) => item.key === field.key)) {
        existing.fields.push(field);
      }
    }
    for (const relationship of required.relationships) {
      if (!existing.relationships.some((item) =>
        item.type === relationship.type &&
        item.targetEntity === relationship.targetEntity
      )) {
        existing.relationships.push(relationship);
      }
    }
  }

  const screens = candidate.screens.map((screen) => ({ ...screen }));
  for (const required of fallback.screens) {
    const existing = screens.find((screen) =>
      screen.key === required.key ||
      (screen.entity && screen.entity === required.entity)
    );
    if (!existing) {
      screens.push(required);
      continue;
    }
    existing.tableColumns = [
      ...new Set([...(existing.tableColumns || []), ...(required.tableColumns || [])])
    ];
    existing.formFields = [
      ...new Set([...(existing.formFields || []), ...(required.formFields || [])])
    ];
    existing.actions = [...new Set([...existing.actions, ...required.actions])];
    existing.filters = [...new Set([...existing.filters, ...required.filters])];
    existing.sorting = [...new Set([...existing.sorting, ...required.sorting])];
    existing.modalActions = [
      ...new Set([...existing.modalActions, ...required.modalActions])
    ];
    existing.exportActions = [
      ...new Set([...existing.exportActions, ...required.exportActions])
    ];
    existing.search ||= required.search;
  }

  const calculations = [...candidate.calculations];
  for (const required of fallback.calculations) {
    if (!calculations.some((item) =>
      item.key === required.key ||
      item.outputField === required.outputField
    )) {
      calculations.push(required);
    }
  }
  const persistenceRequired =
    candidate.persistenceRequired || fallback.persistenceRequired;
  const mergedCollections = entities.map((entity) => ({
    key: entity.key,
    fields: entity.fields,
    ownerScoped: true
  }));
  return {
    ...candidate,
    projectKind: fallback.projectKind !== 'marketing_website'
      ? fallback.projectKind
      : candidate.projectKind,
    entities,
    screens,
    calculations,
    globalActions: [
      ...new Set([...candidate.globalActions, ...fallback.globalActions])
    ],
    dataDependencies: [
      ...new Set([...candidate.dataDependencies, ...fallback.dataDependencies])
    ],
    acceptanceCriteria: [
      ...new Set([...candidate.acceptanceCriteria, ...fallback.acceptanceCriteria])
    ],
    persistenceRequired,
    realTimeRequired:
      candidate.realTimeRequired || fallback.realTimeRequired,
    responsiveRequirements: [
      ...new Set([
        ...candidate.responsiveRequirements,
        ...fallback.responsiveRequirements
      ])
    ],
    backend: {
      required: candidate.backend.required || fallback.backend.required,
      authentication: [
        ...new Set([
          ...candidate.backend.authentication,
          ...fallback.backend.authentication
        ])
      ],
      collections: persistenceRequired
        ? mergedCollections
        : candidate.backend.collections,
      indexes: [
        ...candidate.backend.indexes,
        ...fallback.backend.indexes.filter((required) =>
          !candidate.backend.indexes.some((item) =>
            item.collection === required.collection &&
            item.fields.join('|') === required.fields.join('|')
          )
        )
      ],
      storage: [
        ...new Set([...candidate.backend.storage, ...fallback.backend.storage])
      ],
      functions: [
        ...new Set([...candidate.backend.functions, ...fallback.backend.functions])
      ],
      environmentVariables: [
        ...new Set([
          ...candidate.backend.environmentVariables,
          ...fallback.backend.environmentVariables
        ])
      ]
    },
    forbiddenMarketingSections: [
      ...new Set([
        ...candidate.forbiddenMarketingSections,
        ...fallback.forbiddenMarketingSections
      ])
    ]
  };
}

function normaliseApplicationSpec(
  value: unknown,
  fallback: ApplicationSpec
): ApplicationSpec {
  if (!value || typeof value !== 'object') return fallback;
  const record = value as Record<string, unknown>;
  const allowedKinds = new Set<ProjectKind>([
    'marketing_website', 'portfolio', 'dashboard', 'calculator',
    'crud_application', 'admin_panel', 'ecommerce_application',
    'booking_system', 'management_system', 'functional_application'
  ]);
  const projectKind = typeof record.projectKind === 'string' &&
    allowedKinds.has(record.projectKind as ProjectKind)
    ? record.projectKind as ProjectKind
    : fallback.projectKind;

  const rawEntities = Array.isArray(record.entities) ? record.entities : [];
  const entities: AppSpecEntity[] = rawEntities.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const entity = value as Record<string, unknown>;
    const label = cleanText(entity.label, '', 80);
    const key = keyFromLabel(
      typeof entity.key === 'string' ? entity.key : label,
      'record'
    );
    const fields = (Array.isArray(entity.fields) ? entity.fields : [])
      .map(cleanField)
      .filter((field): field is AppSpecField => Boolean(field));
    if (!label || !fields.length) return [];
    const persistence = entity.persistence === 'none' ||
      entity.persistence === 'local' ||
      entity.persistence === 'firebase' ||
      entity.persistence === 'managed'
      ? entity.persistence
      : fallback.persistenceRequired ? 'managed' : 'local';
    return [{
      key,
      label,
      fields,
      relationships: Array.isArray(entity.relationships)
        ? entity.relationships.flatMap((relationship) => {
            if (!relationship || typeof relationship !== 'object') return [];
            const candidate = relationship as Record<string, unknown>;
            const type = candidate.type === 'one_to_one' ||
              candidate.type === 'one_to_many' ||
              candidate.type === 'many_to_many'
              ? candidate.type
              : 'one_to_many';
            const targetEntity = cleanOptionalText(candidate.targetEntity, 64);
            return targetEntity ? [{
              type,
              targetEntity: keyFromLabel(targetEntity),
              sourceField: cleanOptionalText(candidate.sourceField, 64),
              targetField: cleanOptionalText(candidate.targetField, 64)
            }] : [];
          })
        : [],
      persistence
    }];
  });

  const rawScreens = Array.isArray(record.screens) ? record.screens : [];
  const screens: AppSpecScreen[] = rawScreens.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return [];
    const screen = value as Record<string, unknown>;
    const title = cleanText(screen.title, '', 100);
    if (!title) return [];
    const allowedScreenKinds = new Set<AppSpecScreen['kind']>([
      'landing', 'portfolio', 'dashboard', 'table', 'form', 'detail',
      'calculator', 'settings', 'login', 'other'
    ]);
    return [{
      key: keyFromLabel(
        typeof screen.key === 'string' ? screen.key : title,
        `screen_${index + 1}`
      ),
      title,
      purpose: cleanText(screen.purpose, `Provide the ${title} screen.`, 300),
      kind: typeof screen.kind === 'string' &&
        allowedScreenKinds.has(screen.kind as AppSpecScreen['kind'])
        ? screen.kind as AppSpecScreen['kind']
        : 'other',
      entity: cleanOptionalText(screen.entity, 64),
      tableColumns: cleanStringArray(screen.tableColumns).map((item) => keyFromLabel(item)),
      formFields: cleanStringArray(screen.formFields).map((item) => keyFromLabel(item)),
      actions: cleanStringArray(screen.actions),
      filters: cleanStringArray(screen.filters),
      search: screen.search === true,
      sorting: cleanStringArray(screen.sorting),
      modalActions: cleanStringArray(screen.modalActions),
      exportActions: cleanStringArray(screen.exportActions)
    }];
  });

  const rawCalculations = Array.isArray(record.calculations)
    ? record.calculations
    : [];
  const calculations: AppSpecCalculation[] = rawCalculations.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const calculation = value as Record<string, unknown>;
    const label = cleanText(calculation.label, '', 100);
    const expression = cleanText(calculation.expression, '', 240);
    if (!label || !expression) return [];
    const outputField = keyFromLabel(
      typeof calculation.outputField === 'string'
        ? calculation.outputField
        : label,
      'result'
    );
    return [{
      key: keyFromLabel(
        typeof calculation.key === 'string' ? calculation.key : label,
        outputField
      ),
      label,
      expression,
      inputFields: cleanStringArray(calculation.inputFields).map((item) => keyFromLabel(item)),
      outputField,
      precision: typeof calculation.precision === 'number'
        ? Math.max(0, Math.min(8, Math.floor(calculation.precision)))
        : undefined,
      dependencies: cleanStringArray(calculation.dependencies).map((item) => keyFromLabel(item))
    }];
  });

  const backendRecord = record.backend && typeof record.backend === 'object'
    ? record.backend as Record<string, unknown>
    : {};
  const collectionFallback = entities.map((entity) => ({
    key: entity.key,
    fields: entity.fields,
    ownerScoped: true
  }));
  const collections = Array.isArray(backendRecord.collections)
    ? backendRecord.collections.flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        const collection = value as Record<string, unknown>;
        const key = keyFromLabel(
          typeof collection.key === 'string' ? collection.key : 'records'
        );
        const fields = (Array.isArray(collection.fields) ? collection.fields : [])
          .map(cleanField)
          .filter((field): field is AppSpecField => Boolean(field));
        return fields.length ? [{
          key,
          fields,
          ownerScoped: collection.ownerScoped !== false
        }] : [];
      })
    : [];
  const persistenceRequired = record.persistenceRequired === true ||
    fallback.persistenceRequired;

  return mergeBindingRequirements({
    schemaVersion: 1,
    projectKind,
    title: cleanText(record.title, fallback.title, 100),
    summary: cleanText(record.summary, fallback.summary, 600),
    screens: screens.length ? screens : fallback.screens,
    entities: entities.length ? entities : fallback.entities,
    calculations: calculations.length ? calculations : fallback.calculations,
    globalActions: cleanStringArray(record.globalActions, fallback.globalActions),
    dataDependencies: cleanStringArray(record.dataDependencies, fallback.dataDependencies),
    acceptanceCriteria: cleanStringArray(
      record.acceptanceCriteria,
      fallback.acceptanceCriteria,
      60
    ),
    persistenceRequired,
    realTimeRequired: record.realTimeRequired === true || fallback.realTimeRequired,
    responsiveRequirements: cleanStringArray(
      record.responsiveRequirements,
      fallback.responsiveRequirements
    ),
    backend: {
      required: backendRecord.required === true || persistenceRequired,
      authentication: cleanStringArray(
        backendRecord.authentication,
        fallback.backend.authentication
      ),
      collections: collections.length ? collections : collectionFallback,
      indexes: Array.isArray(backendRecord.indexes)
        ? backendRecord.indexes.flatMap((value) => {
            if (!value || typeof value !== 'object') return [];
            const index = value as Record<string, unknown>;
            const collection = cleanOptionalText(index.collection, 64);
            const fields = cleanStringArray(index.fields).map((item) => keyFromLabel(item));
            return collection && fields.length ? [{
              collection: keyFromLabel(collection),
              fields,
              order: index.order === 'desc' ? 'desc' as const : 'asc' as const
            }] : [];
          })
        : fallback.backend.indexes,
      storage: cleanStringArray(backendRecord.storage, fallback.backend.storage),
      functions: cleanStringArray(backendRecord.functions, fallback.backend.functions),
      environmentVariables: cleanStringArray(
        backendRecord.environmentVariables,
        fallback.backend.environmentVariables
      )
    },
    forbiddenMarketingSections: functionalKinds.has(projectKind)
      ? cleanStringArray(
          record.forbiddenMarketingSections,
          fallback.forbiddenMarketingSections
        )
      : []
  }, fallback);
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
    .slice(0, 7);

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
    sections: sections.length >= 4 ? sections : fallback.sections,
    contact: {
      phone: cleanOptionalText(rawContact.phone, 40) || fallback.contact?.phone,
      email: cleanOptionalText(rawContact.email, 160) || fallback.contact?.email,
      address: cleanOptionalText(rawContact.address, 180) || fallback.contact?.address
    },
    appSpec: normaliseApplicationSpec(candidate.appSpec, fallback.appSpec)
  };
}

class PlannerRemoteError extends Error {
  constructor(
    readonly code: 'timeout' | 'rate_limited' | 'provider_4xx' | 'provider_5xx' | 'network' | 'empty_response',
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'PlannerRemoteError';
  }
}

async function callGemini(instruction: string, options: Options): Promise<unknown> {
  if (!options.apiKey || !options.model) throw new Error('AI API is not configured.');
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('planner_timeout'), 45000);
    try {
      const parts: Array<Record<string, unknown>> = [{ text: instruction }];
      if (options.image) {
        parts.push({
          inlineData: {
            mimeType: options.image.mimeType,
            data: options.image.data
          }
        });
      }
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(options.apiKey)}`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.35,
            maxOutputTokens: 8192
          }
        })
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const retryable = response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        const error = new PlannerRemoteError(
          response.status === 429
            ? 'rate_limited'
            : response.status >= 500
              ? 'provider_5xx'
              : 'provider_4xx',
          `Planner provider returned HTTP ${response.status} (attempt ${attempt}/2)${detail ? `: ${detail.slice(0, 240)}` : ''}`,
          retryable
        );
        if (retryable && attempt < 2) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
          continue;
        }
        throw error;
      }
      const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new PlannerRemoteError(
          'empty_response',
          `Planner returned an empty response (attempt ${attempt}/2).`,
          attempt < 2
        );
      }
      return extractJson(text);
    } catch (error) {
      const timedOut = controller.signal.aborted;
      lastError = timedOut
        ? new PlannerRemoteError(
            'timeout',
            `Planner timed out after 45000ms (attempt ${attempt}/2).`,
            true
          )
        : error instanceof PlannerRemoteError
          ? error
          : new PlannerRemoteError(
              'network',
              `Planner network request failed (attempt ${attempt}/2).`,
              true
            );
      if (
        attempt >= 2 ||
        !(lastError instanceof PlannerRemoteError) ||
        !lastError.retryable
      ) {
        throw lastError;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('Planner request failed.');
}

const DESIGN_DIRECTOR_RULES = `
Act as Nexora AI Design Director, not a generic template filler.
Study the user's industry, audience, goals, personality, requested features and visual references before planning.
Choose one coherent visual direction that genuinely fits the request: luxury cinematic, editorial statement, futuristic glass, conversion commerce, playful expressive, organic calm, minimal refined, or modern professional.
Do not reuse the same page structure or generic copy for unrelated businesses.
Create a memorable hero concept, category-specific information architecture and five to seven distinct sections.
Section titles and bodies must sound written for this exact business, not like placeholders.
Use a deliberate four-colour palette with accessible contrast. All colours must be six-digit hex values.
Only include features that are useful for the request. Prefer practical conversion actions such as booking, enquiry, WhatsApp, catalogue, gallery, testimonials, FAQ, map or pricing when relevant.
Pages must be concise slugs. contact may contain only phone, email and address explicitly supplied by the user.
First classify projectKind as exactly one of marketing_website, portfolio, dashboard, calculator, crud_application, admin_panel, ecommerce_application, booking_system, management_system or functional_application.
For functional projects, model every requested screen, entity, exact table column, form field, formula, dependency, CRUD action, validation, relationship, filter, sorting rule, modal, export and acceptance criterion. Do not add marketing sections unless requested.
Return valid JSON only with exactly these top-level keys: businessName, websiteType, tagline, pages, features, theme, sections, contact, appSpec.
theme must contain style, primary, secondary, background and text.
sections must contain title and body.
appSpec must match the supplied ApplicationSpec schema. It is a binding implementation contract, not a suggestion.
`;

function enforceBindingPalette(
  plan: WebsitePlan,
  prompt: string
): WebsitePlan {
  const palette = prompt.match(
    /Binding website palette \(([^)]+)\):\s*primary\s+(#[0-9a-f]{6}),\s*secondary\s+(#[0-9a-f]{6}),\s*background\s+(#[0-9a-f]{6}),\s*text\s+(#[0-9a-f]{6})/i
  );
  if (!palette) return plan;
  return {
    ...plan,
    theme: {
      ...plan.theme,
      style: `${palette[1].trim()} palette`,
      primary: palette[2],
      secondary: palette[3],
      background: palette[4],
      text: palette[5]
    }
  };
}

export async function buildWebsitePlan(prompt: string, options: Options): Promise<WebsitePlanResult> {
  const fallback = enforceBindingPalette(builtInPlan(prompt), prompt);
  if (!options.apiKey || !options.model) {
    return {
      plan: fallback,
      mode: 'built-in',
      fallbackUsed: true,
      fallbackReason: 'Remote planner is not configured; the structured local planner was used.'
    };
  }
  try {
    const instruction = `${DESIGN_DIRECTOR_RULES}\nUser request:\n${prompt}`;
    return {
      plan: enforceBindingPalette(
        normalisePlan(await callGemini(instruction, options), fallback),
        prompt
      ),
      mode: 'ai',
      fallbackUsed: false
    };
  } catch (error) {
    const fallbackReason = error instanceof Error ? error.message : 'Planner failed.';
    console.error('Nexora structured local planner used:', fallbackReason);
    return {
      plan: fallback,
      mode: 'built-in',
      fallbackUsed: true,
      fallbackReason
    };
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

export async function reviseWebsitePlan(current: WebsitePlan, instruction: string, options: Options): Promise<WebsitePlanResult> {
  const currentWithSpec = current.appSpec
    ? current
    : {
        ...current,
        appSpec: fallbackAppSpec(
          `${current.businessName}. ${current.tagline}. ${instruction}`,
          classifyProjectKind(
            `${current.websiteType} ${current.features.join(' ')} ${instruction}`
          ),
          current.businessName,
          current.pages
        )
      };
  const fallback = builtInRevision(currentWithSpec, instruction);
  if (!options.apiKey || !options.model) {
    return {
      plan: fallback,
      mode: 'built-in',
      fallbackUsed: true,
      fallbackReason: 'Remote planner is not configured; the structured local editor was used.'
    };
  }
  try {
    const prompt = `${DESIGN_DIRECTOR_RULES}
Edit the existing plan according to the user's instruction.
Preserve strong details that were not requested to change, but improve weak or repetitive content.
Return the complete updated plan as JSON only.
Existing plan:
${JSON.stringify(currentWithSpec)}
Edit instruction:
${instruction}`;
    return {
      plan: normalisePlan(await callGemini(prompt, options), fallback),
      mode: 'ai',
      fallbackUsed: false
    };
  } catch (error) {
    const fallbackReason = error instanceof Error ? error.message : 'Planner edit failed.';
    console.error('Nexora structured local editor used:', fallbackReason);
    return {
      plan: fallback,
      mode: 'built-in',
      fallbackUsed: true,
      fallbackReason
    };
  }
}
