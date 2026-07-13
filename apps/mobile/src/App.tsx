import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { Browser } from '@capacitor/browser';
import AdminPanelV5 from './AdminPanelV5';
import ChatStudio, { type LiveBuildActivity } from './ChatStudio';

import CmsStudio from './CmsStudio';
import type { FullStackReport } from './FullStackReportCard';
type AppTheme = 'dark' | 'light' | 'system';
type RuntimeConfig = { apiBase: string; supabaseUrl: string; supabaseAnonKey: string };
type WebsitePlan = { businessName: string; websiteType: string; tagline: string; pages: string[]; features: string[]; theme: { style: string; primary: string; secondary: string; background: string; text: string } };
type GenerateResponse = { projectId: string; jobId?: string; versionNumber?: number; plan: WebsitePlan; previewHtml: string; framework: 'vite-react'; fileCount: number; mode: 'ai' | 'built-in' };
type AccessResponse = {
  approved: true;
  role: 'admin' | 'subscriber';
  maxDevices: number;
  activeDevices: number;
  subscriptionExpiresAt?: string | null;
};
type UsernameSession = {
  token: string;
  expiresAt: string;
  username: string;
  internalEmail: string;
  approved: true;
  role: 'admin' | 'subscriber';
  maxDevices: number;
  activeDevices: number;
  subscriptionExpiresAt?: string | null;
};

type ProjectSourceFile = {
  path: string;
  content: string;
};

type ProjectSourceResponse = {
  projectId: string;
  projectName: string;
  versionNumber: number;
  files: ProjectSourceFile[];
};



type CapabilityPack = {
  id: string;
  name: string;
  icon: string;
  description: string;
  features: string[];
  instruction: string;
};

type WebsiteTemplate = {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  features: string[];
  prompt: string;
};

type ProjectSummary = { id: string; name: string; website_type: string; status: string; framework: string; github_repository?: string | null; production_url?: string | null; deployment_state?: string | null; created_at: string };


type UsageData = {
  used: number;
  limit: number;
  unlimited: boolean;
  remaining: number | null;
  percentage: number;
  resetAt: string;
};

type AnalyticsData = {
  totalWebsites: number;
  liveWebsites: number;
  draftWebsites: number;
  totalBuilds: number;
  completedBuilds: number;
  failedBuilds: number;
  successRate: number;
  buildsToday: number;
  enquiries: number;
  dailyBuilds: Array<{
    date: string;
    label: string;
    count: number;
  }>;
  topWebsiteTypes: Array<{
    name: string;
    count: number;
  }>;
  recentProjects: ProjectSummary[];
};

type IntegrationStatus = { github: { external_account_name?: string | null } | null; vercel: { external_account_name?: string | null } | null };



const capabilityPacks: CapabilityPack[] = [
  {
    id: 'premium-motion',
    name: 'Premium Motion',
    icon: '✦',
    description:
      'Smooth entrances, hover interactions and cinematic scrolling.',
    features: [
      'Scroll reveals',
      'Hover effects',
      'Micro animations',
      'Smooth transitions'
    ],
    instruction: [
      'Add tasteful premium motion effects.',
      'Use smooth section reveals, interactive hover states,',
      'animated buttons and subtle background movement.',
      'Keep animations lightweight, accessible and mobile friendly.'
    ].join(' ')
  },
  {
    id: 'three-dimensional',
    name: '3D Visual Experience',
    icon: '⬡',
    description:
      'Depth, perspective, layered cards and interactive 3D-style visuals.',
    features: [
      '3D cards',
      'Depth effects',
      'Perspective',
      'Layered hero'
    ],
    instruction: [
      'Create a strong three-dimensional visual experience.',
      'Use CSS perspective, layered cards, depth, lighting, shadows,',
      'glass surfaces and interactive tilt-style presentation.',
      'Do not require large external 3D libraries unless essential.',
      'Maintain excellent performance on Android phones.'
    ].join(' ')
  },
  {
    id: 'ecommerce-pro',
    name: 'Ecommerce Pro',
    icon: '▣',
    description:
      'Product categories, offers, conversion sections and shopping UI.',
    features: [
      'Product cards',
      'Categories',
      'Offers',
      'Conversion UI'
    ],
    instruction: [
      'Add a complete ecommerce-style experience.',
      'Include category navigation, product cards, price display,',
      'offers, trust badges, testimonials, product filters,',
      'strong calls to action and mobile shopping navigation.',
      'Do not create fake payment processing.'
    ].join(' ')
  },
  {
    id: 'lead-generation',
    name: 'Lead Generation',
    icon: '◎',
    description:
      'High-converting enquiry sections, WhatsApp and trust signals.',
    features: [
      'Lead forms',
      'WhatsApp',
      'Trust badges',
      'Sticky CTA'
    ],
    instruction: [
      'Optimise the website for lead generation.',
      'Add clear calls to action, an enquiry form, WhatsApp contact,',
      'social proof, trust indicators, FAQs and mobile sticky actions.',
      'Keep forms simple, accessible and conversion focused.'
    ].join(' ')
  },
  {
    id: 'accessibility-plus',
    name: 'Accessibility Plus',
    icon: '◉',
    description:
      'Better contrast, keyboard support, labels and reduced-motion support.',
    features: [
      'Keyboard access',
      'ARIA labels',
      'High contrast',
      'Reduced motion'
    ],
    instruction: [
      'Apply strong accessibility standards.',
      'Use semantic HTML, visible focus states, proper form labels,',
      'keyboard navigation, descriptive alt text, sufficient contrast',
      'and prefers-reduced-motion support.'
    ].join(' ')
  },
  {
    id: 'performance-max',
    name: 'Performance Max',
    icon: '⚡',
    description:
      'Fast loading, lightweight effects and mobile-first optimisation.',
    features: [
      'Fast loading',
      'Mobile first',
      'Lazy media',
      'Lightweight code'
    ],
    instruction: [
      'Prioritise maximum website performance.',
      'Use lightweight components, minimal dependencies, optimised CSS,',
      'lazy-loaded media, responsive images and efficient animations.',
      'Avoid unnecessary libraries and expensive rendering effects.'
    ].join(' ')
  }
];

const websiteTemplates: WebsiteTemplate[] = [
  {
    id: 'premium-jewellery',
    name: 'Luxury Jewellery',
    category: 'Retail',
    icon: '◆',
    description:
      'Premium jewellery showroom with products, collections, WhatsApp and enquiries.',
    features: [
      'Product gallery',
      'WhatsApp',
      'Contact form',
      'Luxury UI'
    ],
    prompt: [
      'Create a premium luxury jewellery website.',
      'Use an elegant black, ivory and gold visual theme.',
      'Include a cinematic hero section, featured jewellery',
      'collections, product cards, bridal collection, trust',
      'section, testimonials, store information, WhatsApp',
      'button, enquiry form, SEO and a mobile-first layout.',
      'Use smooth premium animations and professional typography.'
    ].join(' ')
  },
  {
    id: 'modern-ecommerce',
    name: 'Modern Ecommerce',
    category: 'Commerce',
    icon: '▣',
    description:
      'Conversion-focused online store with categories, offers and product showcases.',
    features: [
      'Categories',
      'Products',
      'Offers',
      'Mobile shop'
    ],
    prompt: [
      'Create a modern high-converting ecommerce website.',
      'Include an announcement bar, searchable navigation,',
      'category cards, featured products, sale section, product',
      'benefits, customer reviews, newsletter, contact form,',
      'WhatsApp and SEO. Use a clean premium mobile-first design',
      'with subtle animations and strong call-to-action buttons.'
    ].join(' ')
  },
  {
    id: 'restaurant-cafe',
    name: 'Restaurant & Cafe',
    category: 'Food',
    icon: '◉',
    description:
      'Restaurant website with menu, reservations, gallery and location.',
    features: [
      'Food menu',
      'Reservations',
      'Gallery',
      'Location'
    ],
    prompt: [
      'Create a cinematic restaurant and cafe website.',
      'Include a full-screen food hero, menu categories, signature',
      'dishes, chef story, restaurant gallery, opening hours,',
      'reservation form, Google Maps location, WhatsApp ordering,',
      'testimonials and SEO. Use warm premium colours and smooth',
      'scroll animations while keeping the website mobile friendly.'
    ].join(' ')
  },
  {
    id: 'smart-tuition',
    name: 'Tuition Academy',
    category: 'Education',
    icon: '✦',
    description:
      'Professional tuition-class website for courses, teachers and admissions.',
    features: [
      'Courses',
      'Faculty',
      'Results',
      'Admissions'
    ],
    prompt: [
      'Create a professional tuition academy website for students',
      'and parents. Include courses by standard and board, faculty',
      'profiles, academic results, student testimonials, class',
      'timings, notes and resources section, admission enquiry form,',
      'WhatsApp contact, FAQs and SEO. Use a trustworthy modern',
      'education theme with a clean responsive mobile layout.'
    ].join(' ')
  },
  {
    id: 'creative-portfolio',
    name: 'Creative Portfolio',
    category: 'Personal',
    icon: '◇',
    description:
      'Personal portfolio for developers, designers and creative professionals.',
    features: [
      'Projects',
      'Skills',
      'Experience',
      'Contact'
    ],
    prompt: [
      'Create a highly polished personal portfolio website.',
      'Include a strong introduction, skills, selected projects,',
      'experience timeline, achievements, services, testimonials,',
      'download resume button, social links and contact form.',
      'Use a unique modern visual identity, smooth interactions,',
      'excellent typography and a responsive mobile-first layout.'
    ].join(' ')
  },
  {
    id: 'saas-startup',
    name: 'AI SaaS Startup',
    category: 'Technology',
    icon: '⬡',
    description:
      'Modern software startup landing page with pricing and product sections.',
    features: [
      'Product demo',
      'Pricing',
      'Features',
      'FAQs'
    ],
    prompt: [
      'Create a premium AI SaaS startup landing page.',
      'Include an impressive product hero, dashboard mockup area,',
      'feature grid, workflow explanation, integrations, use cases,',
      'pricing plans, customer logos, testimonials, FAQ, waitlist',
      'form and SEO. Use a modern glassmorphism-inspired design',
      'with tasteful animations and excellent mobile responsiveness.'
    ].join(' ')
  },
  {
    id: 'real-estate',
    name: 'Real Estate Agency',
    category: 'Property',
    icon: '⌂',
    description:
      'Property agency website with listings, agents and enquiry features.',
    features: [
      'Listings',
      'Property search',
      'Agents',
      'Enquiries'
    ],
    prompt: [
      'Create a premium real estate agency website.',
      'Include property search filters, featured listings, property',
      'cards with pricing and location, agent profiles, neighbourhood',
      'guides, buying and selling services, testimonials, WhatsApp,',
      'property enquiry form and SEO. Use a sophisticated spacious',
      'design that works perfectly on mobile and desktop.'
    ].join(' ')
  },
  {
    id: 'global-export',
    name: 'Global Export Business',
    category: 'Business',
    icon: '◎',
    description:
      'International export company website with products and global reach.',
    features: [
      'Products',
      'Countries',
      'Certifications',
      'Trade enquiries'
    ],
    prompt: [
      'Create a professional international export business website.',
      'Include company introduction, export product categories,',
      'countries served, global supply network, quality assurance,',
      'certifications, packaging process, logistics, trade enquiry',
      'form, WhatsApp contact and SEO. Use a trustworthy premium',
      'corporate design with strong international-business branding.'
    ].join(' ')
  }
];

const ownerEmail = 'poojakpdoshi@gmail.com';
const configKey = 'wmai-runtime-config';
const userSessionKey = 'webforge-user-session';
const themeKey = 'webforge-appearance';


function formatQuotaReset(
  resetAt: string,
  now: number
): string {
  const remaining =
    new Date(resetAt).getTime() - now;

  if (!Number.isFinite(remaining) || remaining <= 0) {
    return 'Resetting now';
  }

  const totalMinutes = Math.ceil(
    remaining / 60000
  );

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `Resets in ${hours}h ${minutes}m`;
  }

  return `Resets in ${minutes}m`;
}

function formatSubscriptionRemaining(
  expiresAt: string | null | undefined,
  now: number
): string {
  if (!expiresAt) {
    return 'Lifetime / no expiry';
  }

  const expiry = new Date(expiresAt).getTime();

  if (!Number.isFinite(expiry)) {
    return 'Expiry unavailable';
  }

  const remaining = expiry - now;

  if (remaining <= 0) {
    return 'Expired';
  }

  const totalMinutes = Math.floor(
    remaining / 60000
  );

  const days = Math.floor(
    totalMinutes / 1440
  );

  const hours = Math.floor(
    (totalMinutes % 1440) / 60
  );

  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h remaining`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m remaining`;
  }

  return `${Math.max(1, minutes)}m remaining`;
}


function zipCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc =
        (crc >>> 1) ^
        (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function zipDosTime(date: Date): {
  time: number;
  day: number;
} {
  const year = Math.max(1980, date.getFullYear());

  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),

    day:
      ((year - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate()
  };
}

function zipHeader(
  size: number
): {
  bytes: Uint8Array;
  view: DataView;
} {
  const bytes = new Uint8Array(size);

  return {
    bytes,
    view: new DataView(bytes.buffer)
  };
}

function createSourceZip(
  files: ProjectSourceFile[]
): Blob {
  const encoder = new TextEncoder();
  const now = zipDosTime(new Date());

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];

  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const content = encoder.encode(file.content);
    const crc = zipCrc32(content);

    const local = zipHeader(30 + name.length);

    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true);
    local.view.setUint16(8, 0, true);
    local.view.setUint16(10, now.time, true);
    local.view.setUint16(12, now.day, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, content.length, true);
    local.view.setUint32(22, content.length, true);
    local.view.setUint16(26, name.length, true);
    local.view.setUint16(28, 0, true);
    local.bytes.set(name, 30);

    localParts.push(local.bytes, content);

    const central = zipHeader(46 + name.length);

    central.view.setUint32(0, 0x02014b50, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, 0x0800, true);
    central.view.setUint16(10, 0, true);
    central.view.setUint16(12, now.time, true);
    central.view.setUint16(14, now.day, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, content.length, true);
    central.view.setUint32(24, content.length, true);
    central.view.setUint16(28, name.length, true);
    central.view.setUint16(30, 0, true);
    central.view.setUint16(32, 0, true);
    central.view.setUint16(34, 0, true);
    central.view.setUint16(36, 0, true);
    central.view.setUint32(38, 0, true);
    central.view.setUint32(42, localOffset, true);
    central.bytes.set(name, 46);

    centralParts.push(central.bytes);

    localOffset +=
      local.bytes.length + content.length;
  }

  const centralSize = centralParts.reduce(
    (total, part) => total + part.length,
    0
  );

  const end = zipHeader(22);

  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(4, 0, true);
  end.view.setUint16(6, 0, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, localOffset, true);
  end.view.setUint16(20, 0, true);

  const parts = [
    ...localParts,
    ...centralParts,
    end.bytes
  ];

  const totalSize = parts.reduce(
    (total, part) => total + part.length,
    0
  );

  const output = new Uint8Array(totalSize);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return new Blob(
    [output.buffer],
    { type: 'application/zip' }
  );
}

function safeDownloadName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'webforge-project';
}

function defaultConfig(): RuntimeConfig {
  return {
    apiBase: (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, ''),
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  };
}

function loadConfig(): RuntimeConfig {
  try {
    const stored = localStorage.getItem(configKey);
    return stored ? { ...defaultConfig(), ...JSON.parse(stored) } : defaultConfig();
  } catch {
    return defaultConfig();
  }
}

function createInstallationId(): string {
  const stored = localStorage.getItem('wmai-installation-id');
  if (stored) return stored;
  const value = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
  localStorage.setItem('wmai-installation-id', value);
  return value;
}

const installationId = createInstallationId();

function validConfig(config: RuntimeConfig) {
  return /^https?:\/\//.test(config.apiBase) && /^https:\/\//.test(config.supabaseUrl) && config.supabaseAnonKey.length > 20;
}

export default function App() {
  const [config, setConfig] = useState<RuntimeConfig>(loadConfig);
  const [showSetup, setShowSetup] = useState(() => !validConfig(loadConfig()));
  const [mode, setMode] = useState<'user' | 'admin-login' | 'admin-dashboard'>('user');
  const supabase = useMemo<SupabaseClient | null>(() => validConfig(config) ? createClient(config.supabaseUrl, config.supabaseAnonKey) : null, [config]);

  const [email, setEmail] = useState(ownerEmail);
  const [session, setSession] = useState<Session | null>(null);
  const [userSession, setUserSession] =
    useState<UsernameSession | null>(() => {
      try {
        const stored = localStorage.getItem(userSessionKey);
        return stored ? JSON.parse(stored) : null;
      } catch {
        return null;
      }
    });
  const [appTheme, setAppTheme] =
    useState<AppTheme>(() => {
      const stored = localStorage.getItem(themeKey);

      return stored === 'dark' ||
        stored === 'light' ||
        stored === 'system'
        ? stored
        : 'system';
    });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [approved, setApproved] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [access, setAccess] = useState<AccessResponse | null>(null);
  const [prompt, setPrompt] = useState('Create a premium modern website for a jewellery shop named Raj Jewels with products, WhatsApp number +919876543210, gallery, enquiry form and SEO.');

  const [templateSearch, setTemplateSearch] =
    useState('');

  const [
    selectedCapabilityIds,
    setSelectedCapabilityIds
  ] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(
        'webforge-capability-packs'
      );

      return stored
        ? JSON.parse(stored) as string[]
        : [];
    } catch {
      return [];
    }
  });


const [editInstruction, setEditInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [activity, setActivity] = useState<LiveBuildActivity | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [
    downloadingProjectId,
    setDownloadingProjectId
  ] = useState<string | null>(null);

const [result, setResult] = useState<GenerateResponse | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  const [analytics, setAnalytics] =
    useState<AnalyticsData | null>(null);


  const [usage, setUsage] =
    useState<UsageData | null>(null);

  const [usageLoading, setUsageLoading] =
    useState(false);

const [analyticsLoading, setAnalyticsLoading] =
    useState(false);

const [connections, setConnections] = useState<IntegrationStatus>({ github: null, vercel: null });
  const [githubToken, setGithubToken] = useState('');
  const [vercelToken, setVercelToken] = useState('');
  const [connectingProvider, setConnectingProvider] =
    useState<'github' | 'vercel' | null>(null);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<
    | 'chat'
    | 'create'
    | 'templates'
    | 'packs'
    | 'preview'
    | 'projects'
    | 'analytics'
    | 'connect'
    | 'account' | 'cms'>('chat');


  const [subscriptionClock, setSubscriptionClock] =
    useState(() => Date.now());

const token = userSession?.token || session?.access_token || '';
  useEffect(() => {
    const timer = window.setInterval(
      () => setSubscriptionClock(Date.now()),
      60000
    );

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const systemTheme = window.matchMedia(
      '(prefers-color-scheme: dark)'
    );

    const applyTheme = () => {
      const resolvedTheme =
        appTheme === 'system'
          ? systemTheme.matches
            ? 'dark'
            : 'light'
          : appTheme;

      document.documentElement.dataset.webforgeTheme =
        resolvedTheme;

      document.documentElement.style.colorScheme =
        resolvedTheme;

      localStorage.setItem(themeKey, appTheme);
    };

    applyTheme();

    systemTheme.addEventListener('change', applyTheme);

    return () => {
      systemTheme.removeEventListener(
        'change',
        applyTheme
      );
    };
  }, [appTheme]);

  useEffect(() => {
    localStorage.setItem(
      'webforge-capability-packs',
      JSON.stringify(selectedCapabilityIds)
    );
  }, [selectedCapabilityIds]);

  const filteredTemplates = useMemo(() => {
    const search = templateSearch
      .trim()
      .toLowerCase();

    if (!search) {
      return websiteTemplates;
    }

    return websiteTemplates.filter((template) =>
      [
        template.name,
        template.category,
        template.description,
        ...template.features
      ].some((value) =>
        value.toLowerCase().includes(search)
      )
    );
  }, [templateSearch]);

  const status = useMemo(() => result ? `${result.plan.businessName} • ${result.framework} • ${result.fileCount} files • ${result.mode === 'ai' ? 'Gemini-assisted brain' : 'Built-in brain'}` : 'No website generated yet', [result]);

  async function readResponse(response: Response) {
    const data = await response
      .json()
      .catch(() => ({
        error:
          'The server returned an invalid response.'
      }));

    if (!response.ok) {
      const securityErrors =
        Array.isArray(data?.securityAudit?.errors)
          ? data.securityAudit.errors.filter(
              (item: unknown) =>
                typeof item === 'string'
            )
          : [];

      const securityDetails =
        securityErrors.length > 0
          ? `\n\nSecurity issues:\n• ${securityErrors.join(
              '\n• '
            )}`
          : '';

      throw new Error(
        `${
          data.error ||
          `Request failed (${response.status})`
        }${securityDetails}`
      );
    }

    return data;
  }

  function authHeaders(activeToken = token) {
    return { Authorization: `Bearer ${activeToken}`, 'X-Device-Id': installationId };
  }

  async function checkAccess(activeEmail: string, activeToken: string) {
    const response = await fetch(`${config.apiBase}/auth/check-access`, {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${activeToken}` },
      body: JSON.stringify({ email: activeEmail, installationId, deviceName: navigator.platform || 'Android device', androidVersion: navigator.userAgent.slice(0, 150) })
    });
    const data = await readResponse(response) as AccessResponse;
    setAccess(data); setApproved(true); return data;
  }



  async function loadUsage() {
    if (!email || !token) return;

    setUsageLoading(true);

    try {
      const response = await fetch(
        `${config.apiBase}/usage?email=${
          encodeURIComponent(email)
        }`,
        {
          headers: authHeaders(token)
        }
      );

      const data =
        await readResponse(response) as UsageData;

      setUsage(data);
    } catch (usageError) {
      setError(
        usageError instanceof Error
          ? usageError.message
          : 'Could not load daily usage.'
      );
    } finally {
      setUsageLoading(false);
    }
  }

  async function loadAnalytics() {
    if (!email || !token) return;

    setAnalyticsLoading(true);
    setError('');

    try {
      const response = await fetch(
        `${config.apiBase}/analytics?email=${
          encodeURIComponent(email)
        }`,
        {
          headers: authHeaders(token)
        }
      );

      const data =
        await readResponse(response) as AnalyticsData;

      setAnalytics(data);
    } catch (analyticsError) {
      setError(
        analyticsError instanceof Error
          ? analyticsError.message
          : 'Could not load analytics.'
      );
    } finally {
      setAnalyticsLoading(false);
    }
  }

async function loadProjects(activeEmail = email, activeToken = token) {
    if (!activeEmail || !activeToken) return;
    const response = await fetch(`${config.apiBase}/projects?email=${encodeURIComponent(activeEmail)}`, { headers: authHeaders(activeToken) });
    const data = await readResponse(response) as { projects: ProjectSummary[] };
    setProjects(data.projects || []);
  }

  async function loadConnections(activeEmail = email, activeToken = token) {
    if (!activeEmail || !activeToken) return;
    const response = await fetch(`${config.apiBase}/integrations/status?email=${encodeURIComponent(activeEmail)}`, { headers: authHeaders(activeToken) });
    const data = await readResponse(response) as IntegrationStatus;
    setConnections(data);
  }

  async function bootstrap(activeSession: Session) {
    const activeEmail = activeSession.user.email?.toLowerCase();
    if (!activeEmail) throw new Error('Your Supabase account has no email address.');
    setSession(activeSession); setEmail(activeEmail);
    await checkAccess(activeEmail, activeSession.access_token);
    await Promise.all([loadProjects(activeEmail, activeSession.access_token), loadConnections(activeEmail, activeSession.access_token)]);
  }

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => { if (data.session) void bootstrap(data.session).catch(() => void supabase.auth.signOut()); });
    const { data } = supabase.auth.onAuthStateChange((_event, activeSession) => {
      if (!activeSession) { setSession(null); setApproved(false); }
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);


  // RESTORE_USERNAME_SESSION
  useEffect(() => {
    const stored = localStorage.getItem(userSessionKey);
    if (!stored || !validConfig(config)) return;

    let saved: UsernameSession;

    try {
      saved = JSON.parse(stored) as UsernameSession;
    } catch {
      localStorage.removeItem(userSessionKey);
      return;
    }

    void fetch(`${config.apiBase}/auth/me`, {
      headers: {
        Authorization: `Bearer ${saved.token}`,
        'X-Device-Id': installationId
      }
    })
      .then(readResponse)
      .then(async (data) => {
        const refreshed: UsernameSession = {
          ...saved,
          ...data,
          token: saved.token
        };

        localStorage.setItem(
          userSessionKey,
          JSON.stringify(refreshed)
        );

        setUserSession(refreshed);
        setSession(null);
        setEmail(refreshed.internalEmail);

        setAccess({
          approved: true,
          role: refreshed.role,
          maxDevices: refreshed.maxDevices,
          activeDevices: refreshed.activeDevices
        });

        setApproved(true);

        const guideKey =
          `webforge-token-guide-seen:${refreshed.username.toLowerCase()}`;

        if (!localStorage.getItem(guideKey)) {
          setShowSetupGuide(true);
          setTab('connect');
        }

        await Promise.all([
          loadProjects(
            refreshed.internalEmail,
            refreshed.token
          ),
          loadConnections(
            refreshed.internalEmail,
            refreshed.token
          )
        ]);
      })
      .catch((startupError: unknown) => {
      const failure =
        startupError instanceof Error
          ? startupError.message
          : String(startupError ?? '');

      const sessionRejected =
        /(?:401|403|unauthori[sz]ed|invalid session|session[^.]{0,40}revoked|account[^.]{0,40}blocked|subscription[^.]{0,40}expired)/i.test(
          failure
        );

      if (sessionRejected) {
        localStorage.removeItem(userSessionKey);
        setUserSession(null);
        setSession(null);
        setApproved(false);
        return;
      }

      setUserSession(saved);
      setSession(null);
      setEmail(saved.internalEmail);

      setAccess({
        approved: true,
        role: saved.role,
        maxDevices: saved.maxDevices,
        activeDevices: saved.activeDevices
      });

      setApproved(true);
    });
  }, [config.apiBase]);


  // RESUME_ACTIVE_GENERATION_JOB
  useEffect(() => {
    const jobId = localStorage.getItem(
      'webforge-active-generation-job'
    );

    const activeToken =
      userSession?.token ||
      session?.access_token ||
      '';

    if (
      !jobId ||
      !approved ||
      !activeToken ||
      !email ||
      !config.apiBase
    ) {
      return;
    }

    const activeJobId = jobId;
    let cancelled = false;

    async function resumeGeneration(): Promise<void> {
      setLoading(true);
      setMessage('Restoring your active WebForge task…');
      setError('');

      try {
        for (let attempt = 0; attempt < 240; attempt += 1) {
          if (cancelled) return;

          const response = await fetch(
            `${config.apiBase}/generation-jobs/${activeJobId}` +
              `?email=${encodeURIComponent(email)}`,
            {
              headers: authHeaders(activeToken)
            }
          );

          const data = await readResponse(response) as {
            job: {
              id: string;
              project_id?: string | null;
              status: string;
              current_step?: string | null;
              current_agent?: string | null;
              progress?: number | null;
              error_message?: string | null;
            };
            events: LiveBuildActivity['events'];
          };

          if (cancelled) return;

          setActivity({
            jobId: activeJobId,
            status: data.job.status,
            progress: Number(data.job.progress || 0),
            currentAgent: data.job.current_agent,
            currentStep: data.job.current_step,
            events: data.events || []
          });

          if (data.job.status === 'failed') {
            localStorage.removeItem(
              'webforge-active-generation-job'
            );

            throw new Error(
              data.job.error_message ||
                'Website generation failed.'
            );
          }

          if (
            data.job.status === 'completed' &&
            data.job.project_id
          ) {
            const projectResponse = await fetch(
              `${config.apiBase}/projects/` +
                `${data.job.project_id}` +
                `?email=${encodeURIComponent(email)}`,
              {
                headers: authHeaders(activeToken)
              }
            );

            const projectData = await readResponse(
              projectResponse
            ) as {
              project: {
                id: string;
                name: string;
                framework: string;
              };
              version: {
                version_number: number;
                plan: WebsitePlan;
                preview_html: string;
              };
            };

            const fileEvent = [...data.events]
              .reverse()
              .find(
                (event) =>
                  event.title === 'Project files created'
              ) as (
                LiveBuildActivity['events'][number] & {
                  metadata?: {
                    fileCount?: number;
                  };
                }
              ) | undefined;

            const generated: GenerateResponse = {
              projectId: projectData.project.id,
              jobId: activeJobId,
              versionNumber:
                projectData.version.version_number,
              plan: projectData.version.plan,
              previewHtml:
                projectData.version.preview_html,
              framework: 'vite-react',
              fileCount: Number(
                fileEvent?.metadata?.fileCount || 0
              ),
              mode: 'ai'
            };

            localStorage.removeItem(
              'webforge-active-generation-job'
            );

            setResult(generated);
            setMessage(
              `${generated.plan.businessName} is ready.`
            );

            await loadProjects(email, activeToken);
            return;
          }

          await new Promise((resolve) =>
            setTimeout(resolve, 1200)
          );
        }

        setMessage(
          'Your project is still running in the background.'
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void resumeGeneration().catch((resumeError) => {
      if (cancelled) return;

      const errorMessage =
        resumeError instanceof Error
          ? resumeError.message
          : 'Could not restore the active task.';

      if (
        errorMessage.toLowerCase().includes('not found')
      ) {
        localStorage.removeItem(
          'webforge-active-generation-job'
        );
      }

      setError(errorMessage);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    approved,
    config.apiBase,
    email,
    userSession?.token,
    session?.access_token
  ]);

  function saveRuntimeConfig(next: RuntimeConfig) {
    const clean = { apiBase: next.apiBase.trim().replace(/\/$/, ''), supabaseUrl: next.supabaseUrl.trim().replace(/\/$/, ''), supabaseAnonKey: next.supabaseAnonKey.trim() };
    if (!validConfig(clean)) { setError('Enter a valid API URL, Supabase project URL, and Supabase anon key.'); return; }
    localStorage.setItem(configKey, JSON.stringify(clean));
    setConfig(clean); setShowSetup(false); setError(''); setMessage('Configuration saved inside the APK.');
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    if (!supabase) { setShowSetup(true); setError('Configure Supabase and the backend first.'); return; }
    if (email.trim().toLowerCase() !== ownerEmail) { setError('Email OTP is reserved for the owner. Normal users must use username and password.'); return; }
    setLoginLoading(true);
    try {
      if (!otpSent) {
        const { error: sendError } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
        if (sendError) throw sendError;
        setOtpSent(true); setMessage('OTP sent to your approved email.'); return;
      }
      if (!/^\d{6,8}$/.test(otp.trim())) throw new Error('Enter the OTP sent to your email.');
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ email, token: otp.trim(), type: 'email' });
      if (verifyError || !data.session) throw verifyError || new Error('OTP verification failed.');
      await bootstrap(data.session);
    } catch (loginError) { setError(loginError instanceof Error ? loginError.message : 'Login failed.'); }
    finally { setLoginLoading(false); }
  }


  async function handleUsernameLogin(event: FormEvent) {
    event.preventDefault();
    setLoginLoading(true);
    setError('');
    setMessage('');

    const loginPayload = {
      username: username.trim(),
      password,
      installationId,
      deviceName: navigator.platform || 'Android device',
      androidVersion: navigator.userAgent.slice(0, 150)
    };

    try {
      const userResponse = await fetch(
        `${config.apiBase}/auth/login`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(loginPayload)
        }
      );

      if (userResponse.ok) {
        const data = await userResponse.json() as UsernameSession;

        if (supabase) {
          await supabase.auth.signOut().catch(() => undefined);
        }

        localStorage.setItem(userSessionKey, JSON.stringify(data));
        localStorage.removeItem('wmai-admin-session');

        setUserSession(data);
        setSession(null);
        setEmail(data.internalEmail);
        setAccess({
          approved: true,
          role: data.role,
          maxDevices: data.maxDevices,
          activeDevices: data.activeDevices
        });
        setApproved(true);
        setPassword('');
        setTab('chat');

        await Promise.all([
          loadProjects(data.internalEmail, data.token),
          loadConnections(data.internalEmail, data.token)
        ]);

        return;
      }

      if (userResponse.status !== 401) {
        await readResponse(userResponse);
      }

      const adminResponse = await fetch(
        `${config.apiBase}/admin/auth/login`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            username: username.trim(),
            password
          })
        }
      );

      if (!adminResponse.ok) {
        throw new Error('Incorrect username or password.');
      }

      const adminData = await adminResponse.json() as {
        token: string;
        expiresAt: string;
        username: string;
      };

      localStorage.setItem('wmai-admin-session', adminData.token);
      localStorage.removeItem(userSessionKey);

      setUserSession(null);
      setSession(null);
      setApproved(false);
      setPassword('');
      setMode('admin-dashboard');
    } catch {
      setError('Incorrect username or password.');
    } finally {
      setLoginLoading(false);
    }
  }

  async function generateWebsite(
    customPrompt?: string,
    returnResult = false,
    image?: {
      name: string;
      dataUrl: string;
    } | null
  ): Promise<GenerateResponse | null> {
    const basePrompt =
      (customPrompt || prompt).trim();

    const capabilityInstruction =
      capabilityPacks
        .filter((pack) =>
          selectedCapabilityIds.includes(pack.id)
        )
        .map((pack) =>
          `[${pack.name}] ${pack.instruction}`
        )
        .join('\n');

    const activePrompt = [
      basePrompt,
      capabilityInstruction
        ? `\nEnabled capability packs:\n${capabilityInstruction}`
        : ''
    ]
      .join('')
      .slice(0, 6000);

    const imageMatch = image?.dataUrl.match(
      /^data:([^;]+);base64,(.+)$/s
    );

    const visionImage = imageMatch
      ? {
          mimeType: imageMatch[1],
          data: imageMatch[2],
          name: image?.name || 'reference-image'
        }
      : undefined;

    if (!approved || activePrompt.length < 20) {
      setError('Please enter a detailed website request.');
      return null;
    }

    setLoading(true);
    setError('');
    setMessage('WebForge Council is starting…');

    try {
      const startResponse = await fetch(
        `${config.apiBase}/generation-jobs/start`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...authHeaders()
          },
          body: JSON.stringify({
            email,
            installationId,
            prompt: activePrompt,
            image: visionImage
          })
        }
      );

      const started = await readResponse(startResponse) as {
        jobId: string;
        status: string;
        progress: number;
      };

      localStorage.setItem(
        'webforge-active-generation-job',
        started.jobId
      );

      setActivity({
        jobId: started.jobId,
        status: started.status,
        progress: started.progress,
        currentAgent: 'Orchestrator',
        currentStep: 'request_received',
        events: []
      });

      for (let attempt = 0; attempt < 240; attempt += 1) {
        const statusResponse = await fetch(
          `${config.apiBase}/generation-jobs/${started.jobId}` +
            `?email=${encodeURIComponent(email)}`,
          {
            headers: authHeaders()
          }
        );

        const statusData = await readResponse(statusResponse) as {
          job: {
            id: string;
            project_id?: string | null;
            status: string;
            current_step?: string | null;
            current_agent?: string | null;
            progress?: number | null;
            error_message?: string | null;
          };
          events: LiveBuildActivity['events'];
        };

        setActivity({
          jobId: started.jobId,
          status: statusData.job.status,
          progress: Number(statusData.job.progress || 0),
          currentAgent: statusData.job.current_agent,
          currentStep: statusData.job.current_step,
          events: statusData.events || []
        });

        if (statusData.job.status === 'failed') {
          localStorage.removeItem(
            'webforge-active-generation-job'
          );

          throw new Error(
            statusData.job.error_message ||
              'Website generation failed.'
          );
        }

        if (
          statusData.job.status === 'completed' &&
          statusData.job.project_id
        ) {
          const projectResponse = await fetch(
            `${config.apiBase}/projects/` +
              `${statusData.job.project_id}` +
              `?email=${encodeURIComponent(email)}`,
            {
              headers: authHeaders()
            }
          );

          const projectData = await readResponse(
            projectResponse
          ) as {
            project: {
              id: string;
              name: string;
              framework: string;
            };
            version: {
              version_number: number;
              plan: WebsitePlan;
              preview_html: string;
            };
          };

          const eventsWithMetadata = statusData.events as Array<
            LiveBuildActivity['events'][number] & {
              metadata?: {
                fileCount?: number;
              };
            }
          >;

          const fileEvent = [...eventsWithMetadata]
            .reverse()
            .find((event) =>
              event.title === 'Project files created'
            );

          const generated: GenerateResponse = {
            projectId: projectData.project.id,
            jobId: started.jobId,
            versionNumber: projectData.version.version_number,
            plan: projectData.version.plan,
            previewHtml: projectData.version.preview_html,
            framework: 'vite-react',
            fileCount: Number(
              fileEvent?.metadata?.fileCount || 0
            ),
            mode: 'ai'
          };

          localStorage.removeItem(
            'webforge-active-generation-job'
          );

          setResult(generated);
          setMessage(
            `${generated.plan.businessName} is ready.`
          );

          await loadProjects();

          if (!returnResult) {
            setTab('preview');
          }

          return generated;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, 1200)
        );
      }

      throw new Error(
        'Generation is still running. Reopen the app to continue tracking it.'
      );
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : 'Website generation failed.'
      );

      return null;
    } finally {
      setLoading(false);
    }
  }

  async function editWebsite() {
    if (!result || !editInstruction.trim()) return;
    setLoading(true); setError(''); setMessage('The AI editor is applying your changes…');
    try {
      const response = await fetch(`${config.apiBase}/projects/${result.projectId}/edit`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ email, installationId, instruction: editInstruction }) });
      const data = await readResponse(response) as GenerateResponse;
      setResult(data); setEditInstruction(''); setMessage(`Version ${data.versionNumber || 'new'} created.`); await loadProjects();
    } catch (editError) { setError(editError instanceof Error ? editError.message : 'Editing failed.'); }
    finally { setLoading(false); }
  }


  async function downloadProjectSource(
    projectId: string
  ) {
    if (!email || !token) return;

    setDownloadingProjectId(projectId);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${config.apiBase}/projects/${
          encodeURIComponent(projectId)
        }/source?email=${
          encodeURIComponent(email)
        }`,
        {
          headers: authHeaders(token)
        }
      );

      const source =
        await readResponse(
          response
        ) as ProjectSourceResponse;

      const zip = createSourceZip(source.files);

      const filename =
        `${safeDownloadName(
          source.projectName
        )}-v${source.versionNumber}.zip`;

      const file = new File(
        [zip],
        filename,
        {
          type: 'application/zip'
        }
      );

      const sharingNavigator =
        navigator as Navigator & {
          canShare?: (
            data?: ShareData
          ) => boolean;
        };

      if (
        typeof navigator.share === 'function' &&
        sharingNavigator.canShare?.({
          files: [file]
        })
      ) {
        await navigator.share({
          title: `${source.projectName} source code`,
          text: 'WebForge.Ai React project source',
          files: [file]
        });
      } else {
        const url = URL.createObjectURL(zip);
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        window.setTimeout(
          () => URL.revokeObjectURL(url),
          30000
        );
      }

      setMessage(
        `${source.projectName} source ZIP is ready.`
      );
    } catch (downloadError) {
      if (
        downloadError instanceof DOMException &&
        downloadError.name === 'AbortError'
      ) {
        return;
      }

      setError(
        downloadError instanceof Error
          ? downloadError.message
          : 'Could not download project source.'
      );
    } finally {
      setDownloadingProjectId(null);
    }
  }

async function openProject(projectId: string) {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${config.apiBase}/projects/${projectId}?email=${encodeURIComponent(email)}`, { headers: authHeaders() });
      const data = await readResponse(response) as { version: { version_number: number; plan: WebsitePlan; preview_html: string; full_stack_report?: FullStackReport | null } };
      setResult({ projectId, versionNumber: data.version.version_number, plan: data.version.plan, previewHtml: data.version.preview_html, framework: 'vite-react', fileCount: 9, mode: 'built-in' }); setTab('preview');
    } catch (projectError) { setError(projectError instanceof Error ? projectError.message : 'Could not open project.'); }
    finally { setLoading(false); }
  }


  async function connectWithToken(
    provider: 'github' | 'vercel',
    rawToken: string
  ) {
    const cleanToken = rawToken.trim();

    if (cleanToken.length < 10) {
      setError(`Paste a valid ${provider === 'github' ? 'GitHub' : 'Vercel'} access token.`);
      return;
    }

    setConnectingProvider(provider);
    setError('');
    setMessage(`Checking ${provider} token…`);

    try {
      const response = await fetch(
        `${config.apiBase}/integrations/${provider}/token`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...authHeaders()
          },
          body: JSON.stringify({
            email,
            installationId,
            token: cleanToken
          })
        }
      );

      const data = await readResponse(response) as {
        accountName?: string;
      };

      if (provider === 'github') {
        setGithubToken('');
      } else {
        setVercelToken('');
      }

      await loadConnections();

      setMessage(
        `${provider === 'github' ? 'GitHub' : 'Vercel'} connected${
          data.accountName ? ` as ${data.accountName}` : ''
        }.`
      );
    } catch (connectionError) {
      setError(
        connectionError instanceof Error
          ? connectionError.message
          : `Could not connect ${provider}.`
      );
    } finally {
      setConnectingProvider(null);
    }
  }

  async function refreshConnections() {
    setError('');
    try { await loadConnections(); setMessage('Connection status refreshed.'); }
    catch (connectionError) { setError(connectionError instanceof Error ? connectionError.message : 'Could not refresh connections.'); }
  }

  async function publishWebsite() {
    if (!result) return;
    setPublishing(true); setError(''); setMessage('Running final checks, GitHub push, and Vercel preview…');
    try {
      const response = await fetch(`${config.apiBase}/projects/${result.projectId}/publish`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ email, installationId }) });
      const data = await readResponse(response) as { productionUrl: string; state: string };
      setMessage(`Published. Vercel state: ${data.state}`); await loadProjects(); if (data.productionUrl) await Browser.open({ url: data.productionUrl });
    } catch (publishError) { setError(publishError instanceof Error ? publishError.message : 'Publishing failed.'); }
    finally { setPublishing(false); }
  }

  async function logout() {
    if (userSession?.token) {
      await fetch(`${config.apiBase}/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userSession.token}`
        }
      }).catch(() => undefined);
    }

    if (session && supabase) {
      await supabase.auth.signOut().catch(() => undefined);
    }

    localStorage.removeItem(userSessionKey);

    setUserSession(null);
    setApproved(false);
    setAccess(null);
    setSession(null);
    setEmail(ownerEmail);
    setUsername('');
    setPassword('');
    setOtp('');
    setOtpSent(false);
    setResult(null);
    setProjects([]);
    setConnections({
      github: null,
      vercel: null
    });
    setTab('chat');
    setError('');
    setMessage('');
  }

  if (showSetup) return <SetupScreen config={config} onSave={saveRuntimeConfig} onCancel={validConfig(config) ? () => setShowSetup(false) : undefined} error={error} />;
  if (mode === 'admin-dashboard') return <AdminPanelV5 apiBase={config.apiBase} initialMode={mode} onMode={setMode} onSetup={() => setShowSetup(true)} />;

  if (!approved) {
    return (
      <main className="login-shell">
        <section className="login-card universal-login-card">
          <div className="brand-mark logo-shell">
            <img src="/webforge-logo.svg" alt="WebForge.Ai" />
          </div>

          <p className="eyebrow">MADE BY POOJAK DOSHI</p>
          <h1>WebForge.Ai</h1>
          <p className="muted">Secure access to your workspace</p>

          <form onSubmit={handleUsernameLogin}>
            <label>
              Username
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                disabled={loginLoading}
                required
              />
            </label>

            <label>
              Password
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                disabled={loginLoading}
                required
              />
            </label>

            <button type="submit" disabled={loginLoading}>
              {loginLoading ? 'Signing in…' : 'Log In'}
            </button>
          </form>

          {message && <p className="success">{message}</p>}
          {error && <p className="error" role="alert">{error}</p>}

          <p className="login-security-note">
            Protected workspace access
          </p>
        </section>
      </main>
    );
  }

  return <main
    className={
      tab === 'chat'
        ? 'app-shell chat-page-active'
        : 'app-shell'
    }
  >
    <header><div><p className="eyebrow">WEBFORGE.AI</p><h1>Build and publish without coding</h1></div><span className="pill">V4.2 • CHAT BUILD</span></header>
    <nav className="webforge-app-nav">
      <button
        className={tab === 'chat' ? 'active' : ''}
        onClick={() => setTab('chat')}
      >
        Chat
      </button>

      <button
        className={tab === 'create' ? 'active' : ''}
        onClick={() => setTab('create')}
      >
        Create
      </button>

      <button
        className={tab === 'packs' ? 'active' : ''}
        onClick={() => setTab('packs')}
      >
        Packs
        {selectedCapabilityIds.length > 0 && (
          <small className="pack-nav-count">
            {selectedCapabilityIds.length}
          </small>
        )}
      </button>

      <button
        className={tab === 'templates' ? 'active' : ''}
        onClick={() => setTab('templates')}
      >
        Templates
      </button>

      <button
        className={tab === 'preview' ? 'active' : ''}
        onClick={() => setTab('preview')}
      >
        Preview
      </button>

      <button
        className={tab === 'projects' ? 'active my-webs-tab' : 'my-webs-tab'}
        onClick={() => {
          setTab('projects');
          void loadProjects();
        }}
      >
        <span>My Webs</span>
        {projects.length > 0 && (
          <small className="my-webs-count">
            {projects.length}
          </small>
        )}
      </button>

      <button
        className={tab === 'analytics' ? 'active' : ''}
        onClick={() => {
          setTab('analytics');
          void loadAnalytics();
        }}
      >
        Analytics
      </button>

      <button
        className={tab === 'connect' ? 'active' : ''}
        onClick={() => setTab('connect')}
      >
        Connect
      </button>

      <button
              type="button"
              className={tab === 'cms' ? 'active' : ''}
              onClick={() => setTab('cms')}
            >
              CMS
            </button>

            <button
        className={tab === 'account' ? 'active' : ''}
        onClick={() => {
          setTab('account');
          void loadUsage();
        }}
      >
        Account
      </button>
    </nav>
    {message && <p className="success notice-wide">{message}</p>}{error && <p className="error notice-wide" role="alert">{error}</p>}
    {tab === 'chat' && (
      <ChatStudio
        busy={loading}
        activity={activity}
        onOpenPreview={() => setTab('preview')}
        onNavigate={(nextTab) => {
          setTab(nextTab);

          if (nextTab === 'projects') {
            void loadProjects();
          }
        }}
        onGenerate={async (chatPrompt, chatImage) => {
          const generated = await generateWebsite(
            chatPrompt,
            true,
            chatImage
          );

          return generated
            ? { projectName: generated.plan.businessName }
            : null;
        }}
      />
    )}

    {tab === 'packs' && (
      <section className="panel capability-panel">
        <div className="capability-heading">
          <div>
            <p className="eyebrow">
              WEBSITE POWER-UPS
            </p>

            <h2>Capability packs</h2>

            <p className="muted">
              Select extra capabilities that the AI council
              must include in every generated website.
            </p>
          </div>

          {selectedCapabilityIds.length > 0 && (
            <button
              type="button"
              className="refresh"
              onClick={() =>
                setSelectedCapabilityIds([])
              }
            >
              Clear all
            </button>
          )}
        </div>

        <div className="capability-summary">
          <strong>
            {selectedCapabilityIds.length}
          </strong>

          <span>
            active capability
            {selectedCapabilityIds.length === 1
              ? ''
              : ' packs'}
          </span>
        </div>

        <div className="capability-grid">
          {capabilityPacks.map((pack) => {
            const selected =
              selectedCapabilityIds.includes(
                pack.id
              );

            return (
              <article
                className={
                  selected
                    ? 'capability-card selected'
                    : 'capability-card'
                }
                key={pack.id}
              >
                <div className="capability-card-top">
                  <span>{pack.icon}</span>

                  <button
                    type="button"
                    className="capability-toggle"
                    aria-pressed={selected}
                    onClick={() => {
                      setSelectedCapabilityIds(
                        (current) =>
                          current.includes(pack.id)
                            ? current.filter(
                                (id) => id !== pack.id
                              )
                            : [...current, pack.id]
                      );
                    }}
                  >
                    {selected ? 'Enabled' : 'Enable'}
                  </button>
                </div>

                <div>
                  <h3>{pack.name}</h3>
                  <p>{pack.description}</p>
                </div>

                <div className="capability-features">
                  {pack.features.map((feature) => (
                    <span key={feature}>
                      {feature}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>

        <button
          type="button"
          className="primary capability-continue"
          onClick={() => setTab('create')}
        >
          Continue to website builder
        </button>
      </section>
    )}

    {tab === 'templates' && (
      <section className="panel templates-panel">
        <div className="templates-heading">
          <div>
            <p className="eyebrow">
              READY-TO-BUILD DESIGNS
            </p>

            <h2>Template library</h2>

            <p className="muted">
              Choose a professional starting point,
              customise the prompt and generate your website.
            </p>
          </div>

          <label className="template-search">
            <span>Search templates</span>

            <input
              value={templateSearch}
              onChange={(event) =>
                setTemplateSearch(event.target.value)
              }
              placeholder="Jewellery, ecommerce, tuition…"
              type="search"
            />
          </label>
        </div>

        <div className="template-results">
          <span>
            {filteredTemplates.length}
            {' '}
            template
            {filteredTemplates.length === 1
              ? ''
              : 's'}
          </span>
        </div>

        <div className="template-grid">
          {filteredTemplates.map((template) => (
            <article
              className="template-card"
              key={template.id}
            >
              <div className="template-card-top">
                <span className="template-icon">
                  {template.icon}
                </span>

                <small>
                  {template.category}
                </small>
              </div>

              <div>
                <h3>{template.name}</h3>

                <p>{template.description}</p>
              </div>

              <div className="template-features">
                {template.features.map((feature) => (
                  <span key={feature}>
                    {feature}
                  </span>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setPrompt(template.prompt);
                  setTab('create');

                  setMessage(
                    `${template.name} template selected.`
                  );

                  setError('');
                }}
              >
                Use this template
              </button>
            </article>
          ))}
        </div>

        {!filteredTemplates.length && (
          <div className="empty compact">
            No matching templates found.
          </div>
        )}
      </section>
    )}

    {tab === 'create' && <section className="panel"><p className="eyebrow">ORCHESTRATED AI BRAIN</p><h2>Describe the complete website</h2><p className="muted">Gemini assists with planning and content. The orchestrator, templates, validators, and build system remain in control.</p><div className="chips"><span>React source</span><span>Auto logo</span><span>SEO</span><span>Database form</span><span>Double validation</span><span>Vercel publish</span></div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={10} maxLength={6000} /><p className="prompt-count">{prompt.length}/6000</p><button className="primary" onClick={() => void generateWebsite()} disabled={loading || prompt.trim().length < 20}>{loading ? 'Building project…' : 'Generate website'}</button></section>}
    {tab === 'preview' && <section className="panel preview-panel">{result ? <><div className="preview-top"><div><p className="eyebrow">LIVE PREVIEW</p><h2>{status}</h2></div><div className="preview-actions"><button onClick={() => void downloadProjectSource(result.projectId)} disabled={downloadingProjectId === result.projectId}>{downloadingProjectId === result.projectId ? 'Preparing ZIP…' : 'Download Source ZIP'}</button><button onClick={publishWebsite} disabled={publishing || !connections.github || !connections.vercel}>{publishing ? 'Publishing…' : 'Push + deploy'}</button></div></div>{(!connections.github || !connections.vercel) && <p className="notice">Connect GitHub and Vercel before publishing.</p>}<iframe title="Generated website preview" sandbox="allow-forms allow-scripts allow-popups" srcDoc={result.previewHtml} /><div className="editor-box"><h3>AI website editor</h3><textarea value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} rows={4} placeholder="Change the theme, add pricing, remove a section…" /><button onClick={editWebsite} disabled={loading || !editInstruction.trim()}>{loading ? 'Applying changes…' : 'Apply edit'}</button></div></> : <div className="empty">Generate or open a project first.</div>}</section>}
    {tab === 'cms' && (
          <CmsStudio
            apiBase={config.apiBase}
            email={email}
            token={token}
            installationId={installationId}
            projects={projects}
          />
        )}

        {tab === 'analytics' && (
      <section className="panel analytics-panel">
        <div className="analytics-heading">
          <div>
            <p className="eyebrow">
              PERFORMANCE DASHBOARD
            </p>

            <h2>Website analytics</h2>

            <p className="muted">
              Track builds, published websites,
              enquiries and AI generation success.
            </p>
          </div>

          <button
            className="refresh"
            onClick={() => void loadAnalytics()}
            disabled={analyticsLoading}
          >
            {analyticsLoading
              ? 'Refreshing…'
              : 'Refresh analytics'}
          </button>
        </div>

        {analytics ? (
          <>
            <div className="analytics-grid">
              <article>
                <span>Total websites</span>
                <strong>
                  {analytics.totalWebsites}
                </strong>
                <small>
                  All generated projects
                </small>
              </article>

              <article>
                <span>Live websites</span>
                <strong>
                  {analytics.liveWebsites}
                </strong>
                <small>
                  Successfully published
                </small>
              </article>

              <article>
                <span>AI builds</span>
                <strong>
                  {analytics.totalBuilds}
                </strong>
                <small>
                  {analytics.buildsToday} today
                </small>
              </article>

              <article>
                <span>Success rate</span>
                <strong>
                  {analytics.successRate}%
                </strong>
                <small>
                  {analytics.completedBuilds} completed
                </small>
              </article>

              <article>
                <span>Failed builds</span>
                <strong>
                  {analytics.failedBuilds}
                </strong>
                <small>
                  Validation or provider failures
                </small>
              </article>

              <article>
                <span>Enquiries</span>
                <strong>
                  {analytics.enquiries}
                </strong>
                <small>
                  Website form submissions
                </small>
              </article>
            </div>

            <div className="analytics-layout">
              <article className="analytics-chart-card">
                <div>
                  <span>LAST 7 DAYS</span>
                  <h3>Generation activity</h3>
                </div>

                <div className="analytics-bars">
                  {analytics.dailyBuilds.map(
                    (item) => {
                      const peak = Math.max(
                        1,
                        ...analytics.dailyBuilds.map(
                          (point) => point.count
                        )
                      );

                      const height = Math.max(
                        8,
                        Math.round(
                          (item.count / peak) * 100
                        )
                      );

                      return (
                        <div
                          className="analytics-bar-item"
                          key={item.date}
                        >
                          <strong>{item.count}</strong>

                          <div className="analytics-bar-track">
                            <span
                              style={{
                                height: `${height}%`
                              }}
                            />
                          </div>

                          <small>{item.label}</small>
                        </div>
                      );
                    }
                  )}
                </div>
              </article>

              <article className="analytics-types-card">
                <div>
                  <span>POPULAR CATEGORIES</span>
                  <h3>Website types</h3>
                </div>

                <div className="analytics-type-list">
                  {analytics.topWebsiteTypes.length ? (
                    analytics.topWebsiteTypes.map(
                      (item) => (
                        <div key={item.name}>
                          <span>{item.name}</span>
                          <strong>{item.count}</strong>
                        </div>
                      )
                    )
                  ) : (
                    <p className="muted">
                      No category data yet.
                    </p>
                  )}
                </div>
              </article>
            </div>
          </>
        ) : (
          <div className="empty compact">
            {analyticsLoading
              ? 'Loading analytics…'
              : 'Tap refresh to load analytics.'}
          </div>
        )}
      </section>
    )}

    {tab === 'projects' && (
      <section className="panel my-webs-panel">
        <div className="my-webs-heading">
          <div>
            <p className="eyebrow">MY WEBS</p>
            <h2>All your websites</h2>
            <p className="muted">
              Open, edit or visit every website created from this account.
            </p>
          </div>

          <button
            className="my-webs-refresh"
            onClick={() => void loadProjects()}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        <div className="my-webs-summary">
          <span>Total websites</span>
          <strong>{projects.length}</strong>
        </div>

        <div className="project-list my-webs-list">
          {projects.length ? (
            projects.map((project) => (
              <article key={project.id}>
                <div className="my-web-details">
                  <strong>{project.name}</strong>

                  <span>
                    {project.website_type}
                    {' • '}
                    {project.framework}
                    {' • '}
                    {project.status}
                  </span>

                  {project.production_url && (
                    <small>Live website available</small>
                  )}
                </div>

                <div className="project-actions">
                  <button
                    onClick={() => void openProject(project.id)}
                  >
                    Open
                  </button>

                  <button
                    onClick={() =>
                      void downloadProjectSource(project.id)
                    }
                    disabled={
                      downloadingProjectId === project.id
                    }
                  >
                    {downloadingProjectId === project.id
                      ? 'Preparing…'
                      : 'Download ZIP'}
                  </button>

                  {project.production_url && (
                    <a
                      href={project.production_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Live
                    </a>
                  )}

                  {project.github_repository && (
                    <a
                      href={project.github_repository}
                      target="_blank"
                      rel="noreferrer"
                    >
                      GitHub
                    </a>
                  )}
                </div>
              </article>
            ))
          ) : (
            <div className="empty compact my-webs-empty">
              <strong>No websites yet</strong>
              <span>
                Create your first website and it will appear here.
              </span>
            </div>
          )}
        </div>
      </section>
    )}

    {tab === 'connect' && (
      <section className="panel">
        <p className="eyebrow">PUBLISHING ACCOUNTS</p>
        <h2>Paste access tokens</h2>
        <p className="muted">
          Tokens are sent to the backend, verified, encrypted and stored for this WebForge account.
        </p>

        <button
          type="button"
          className="refresh"
          onClick={() => setShowSetupGuide((current) => !current)}
        >
          {showSetupGuide ? 'Hide setup guide' : 'Open setup guide'}
        </button>

        {showSetupGuide && (
          <section className="panel token-setup-guide">
            <p className="eyebrow">NEW USER SETUP</p>
            <h2>GitHub and Vercel token setup</h2>

            <p className="muted">
              Use personal access tokens. Do not paste account passwords,
              OAuth Client IDs or OAuth Client Secrets.
            </p>

            <article>
              <h3>1. Create your GitHub token</h3>

              <ol>
                <li>Tap the direct GitHub button below and sign in.</li>
                <li>Keep the description as WebForge.Ai.</li>
                <li>Select an expiration date.</li>
                <li>Enable the public_repo permission.</li>
                <li>Generate and copy the token immediately.</li>
                <li>Return to WebForge.Ai and paste it in the GitHub field.</li>
              </ol>

              <button
                type="button"
                onClick={() =>
                  void Browser.open({
                    url: 'https://github.com/settings/tokens/new?scopes=public_repo&description=WebForge.Ai'
                  })
                }
              >
                Open GitHub Token Page
              </button>
            </article>

            <article>
              <h3>2. Create your Vercel token</h3>

              <ol>
                <li>Tap the direct Vercel button below and sign in.</li>
                <li>Tap Create Token.</li>
                <li>Name the token WebForge.Ai.</li>
                <li>Select the account where websites should deploy.</li>
                <li>Select an expiration date and create the token.</li>
                <li>Copy it, return here and paste it in the Vercel field.</li>
              </ol>

              <button
                type="button"
                onClick={() =>
                  void Browser.open({
                    url: 'https://vercel.com/account/settings/tokens'
                  })
                }
              >
                Open Vercel Token Page
              </button>
            </article>

            <article>
              <h3>3. Connect both accounts</h3>

              <ol>
                <li>Paste and connect the GitHub token.</li>
                <li>Paste and connect the Vercel token.</li>
                <li>Both cards must show Connected before publishing.</li>
                <li>Never share either token with another person.</li>
              </ol>

              <button
                type="button"
                onClick={() => {
                  const accountName = (
                    userSession?.username || email
                  ).toLowerCase();

                  localStorage.setItem(
                    `webforge-token-guide-seen:${accountName}`,
                    '1'
                  );

                  setShowSetupGuide(false);
                }}
              >
                Got it - Continue
              </button>
            </article>
          </section>
        )}

        <div className="connection-grid">
          <article className={connections.github ? 'connected' : ''}>
            <h3>GitHub</h3>
            <p>
              {connections.github
                ? `Connected as ${connections.github.external_account_name || 'GitHub user'}`
                : 'Paste a GitHub personal access token with repository access.'}
            </p>

            <input
              type="password"
              value={githubToken}
              onChange={(event) => setGithubToken(event.target.value)}
              placeholder="Paste GitHub access token"
              autoComplete="off"
              spellCheck={false}
            />

            <button
              onClick={() => void connectWithToken('github', githubToken)}
              disabled={
                connectingProvider !== null ||
                githubToken.trim().length < 10
              }
            >
              {connectingProvider === 'github'
                ? 'Checking GitHub…'
                : connections.github
                  ? 'Replace GitHub Token'
                  : 'Connect GitHub Token'}
            </button>
          </article>

          <article className={connections.vercel ? 'connected' : ''}>
            <h3>Vercel</h3>
            <p>
              {connections.vercel
                ? `Connected to ${connections.vercel.external_account_name || 'Vercel'}`
                : 'Paste a Vercel access token for live deployment.'}
            </p>

            <input
              type="password"
              value={vercelToken}
              onChange={(event) => setVercelToken(event.target.value)}
              placeholder="Paste Vercel access token"
              autoComplete="off"
              spellCheck={false}
            />

            <button
              onClick={() => void connectWithToken('vercel', vercelToken)}
              disabled={
                connectingProvider !== null ||
                vercelToken.trim().length < 10
              }
            >
              {connectingProvider === 'vercel'
                ? 'Checking Vercel…'
                : connections.vercel
                  ? 'Replace Vercel Token'
                  : 'Connect Vercel Token'}
            </button>
          </article>
        </div>

        <button
          className="refresh"
          onClick={refreshConnections}
          disabled={connectingProvider !== null}
        >
          Refresh connections
        </button>
      </section>
    )}
    {tab === 'account' && <section className="panel"><p className="eyebrow">ACCOUNT</p><h2>{userSession?.username || email}</h2><div className="account-grid"><article><span>Role</span><strong>{access?.role}</strong></article><article><span>Devices</span><strong>{access?.activeDevices}/{access?.maxDevices}</strong></article><article><span>Subscription</span><strong>{formatSubscriptionRemaining(userSession?.subscriptionExpiresAt ?? access?.subscriptionExpiresAt, subscriptionClock)}</strong></article><article><span>GitHub</span><strong>{connections.github ? 'Connected' : 'Not connected'}</strong></article><article><span>Vercel</span><strong>{connections.vercel ? 'Connected' : 'Not connected'}</strong></article><article><span>Daily AI builds</span><strong>{usage ? usage.unlimited ? 'Unlimited' : `${usage.used}/${usage.limit}` : '—'}</strong></article></div>{!userSession && email === ownerEmail && <button onClick={() => setMode('admin-login')}>Open Admin</button>}<section className="usage-meter"><div className="usage-meter-heading"><div><span>Daily generation quota</span><small>{usage ? usage.unlimited ? 'Admin account has unlimited generation access.' : `${usage.remaining} website generation${usage.remaining === 1 ? '' : 's'} remaining today.` : usageLoading ? 'Loading usage…' : 'Open Account to load usage.'}</small></div><button type="button" className="refresh" onClick={() => void loadUsage()} disabled={usageLoading}>{usageLoading ? 'Checking…' : 'Refresh'}</button></div>{usage && !usage.unlimited && <><div className="usage-progress" role="progressbar" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={usage.used}><span style={{ width: `${usage.percentage}%` }} /></div><div className="usage-meter-footer"><span>{usage.used} used</span><span>{formatQuotaReset(usage.resetAt, subscriptionClock)}</span><span>{usage.limit} limit</span></div></>}</section><section className="theme-setting"><div><span>Appearance</span><small>Choose how WebForge.Ai looks on this device.</small></div><div className="theme-choice"><button type="button" className={appTheme === 'dark' ? 'selected' : ''} onClick={() => setAppTheme('dark')}>Dark</button><button type="button" className={appTheme === 'light' ? 'selected' : ''} onClick={() => setAppTheme('light')}>Light</button><button type="button" className={appTheme === 'system' ? 'selected' : ''} onClick={() => setAppTheme('system')}>System</button></div></section><button className="logout" onClick={() => void logout()}>Log out</button></section>}
    <footer>WebForge.Ai V4.2 · Made by Poojak Doshi</footer>
  </main>;
}

function SetupScreen({ config, onSave, onCancel, error }: { config: RuntimeConfig; onSave: (config: RuntimeConfig) => void; onCancel?: () => void; error: string }) {
  const [draft, setDraft] = useState(config);
  return <main className="login-shell"><section className="login-card"><div className="brand-mark">⚙</div><p className="eyebrow">ONE-TIME APP SETUP</p><h1>Connect the APK</h1><p className="muted">Paste the public backend URL and the two public Supabase values. These can be changed later without rebuilding the APK.</p><form onSubmit={(event) => { event.preventDefault(); onSave(draft); }}><label>Backend API URL<input value={draft.apiBase} onChange={(event) => setDraft({ ...draft, apiBase: event.target.value })} placeholder="https://your-api.workers.dev" /></label><label>Supabase Project URL<input value={draft.supabaseUrl} onChange={(event) => setDraft({ ...draft, supabaseUrl: event.target.value })} placeholder="https://xxxxx.supabase.co" /></label><label>Supabase anon/public key<input value={draft.supabaseAnonKey} onChange={(event) => setDraft({ ...draft, supabaseAnonKey: event.target.value })} placeholder="eyJ..." /></label><button>Save and continue</button></form>{onCancel && <button className="small-button" onClick={onCancel}>Cancel</button>}{error && <p className="error">{error}</p>}<p className="tiny">Never paste the Supabase service-role key or Gemini key here.</p></section></main>;
}

