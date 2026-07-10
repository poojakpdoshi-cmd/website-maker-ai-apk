export type WebsiteSection = {
  title: string;
  body: string;
};

export type WebsitePlan = {
  businessName: string;
  websiteType: string;
  tagline: string;
  pages: string[];
  features: string[];
  theme: {
    style: string;
    primary: string;
    secondary: string;
    background: string;
    text: string;
  };
  sections: WebsiteSection[];
  contact?: {
    phone?: string;
    email?: string;
    address?: string;
  };
};

export type GeneratedProjectFile = {
  path: string;
  content: string;
};

export type GeneratedProject = {
  files: GeneratedProjectFile[];
  previewHtml: string;
  framework: 'vite-react';
};
