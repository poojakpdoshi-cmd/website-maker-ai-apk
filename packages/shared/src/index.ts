export type WebsiteSection = {
  title: string;
  body: string;
};

export type ProjectKind = "marketing-site" | "web-application" | "dashboard" | "calculator" | "ecommerce" | "admin-panel" | "portfolio" | "other";

export type DataFieldSpec = {
  name: string;
  type: string;
  required: boolean;
  derived?: boolean;
  relation?: string;
};

export type DataEntitySpec = {
  name: string;
  fields: DataFieldSpec[];
};

export type UiModuleSpec = {
  id: string;
  title: string;
  kind: string;
  columns?: string[];
  actions: string[];
};

export type CalculationSpec = {
  id: string;
  label: string;
  formula: string;
  inputs: string[];
  output: string;
};

export type ApplicationSpec = {
  goal: string;
  audience: string;
  entities: DataEntitySpec[];
  modules: UiModuleSpec[];
  calculations: CalculationSpec[];
  validations: string[];
  acceptanceCriteria: string[];
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
  projectKind?: ProjectKind;
  appSpec?: ApplicationSpec;
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
