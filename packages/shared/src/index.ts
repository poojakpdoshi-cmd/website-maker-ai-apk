export type ProjectKind =
  | 'marketing_website'
  | 'portfolio'
  | 'dashboard'
  | 'calculator'
  | 'crud_application'
  | 'admin_panel'
  | 'ecommerce_application'
  | 'booking_system'
  | 'management_system'
  | 'functional_application';

export type PrimitiveFieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'currency'
  | 'percentage'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'email'
  | 'phone'
  | 'url'
  | 'select'
  | 'reference';

export type AppSpecField = {
  key: string;
  label: string;
  type: PrimitiveFieldType;
  required: boolean;
  options?: string[];
  validation?: string[];
  referenceEntity?: string;
  defaultValue?: string | number | boolean | null;
};

export type AppSpecEntity = {
  key: string;
  label: string;
  fields: AppSpecField[];
  relationships: Array<{
    type: 'one_to_one' | 'one_to_many' | 'many_to_many';
    targetEntity: string;
    sourceField?: string;
    targetField?: string;
  }>;
  persistence: 'none' | 'local' | 'firebase' | 'managed';
};

export type AppSpecScreen = {
  key: string;
  title: string;
  purpose: string;
  kind:
    | 'landing'
    | 'portfolio'
    | 'dashboard'
    | 'table'
    | 'form'
    | 'detail'
    | 'calculator'
    | 'settings'
    | 'login'
    | 'other';
  entity?: string;
  tableColumns?: string[];
  formFields?: string[];
  actions: string[];
  filters: string[];
  search: boolean;
  sorting: string[];
  modalActions: string[];
  exportActions: string[];
};

export type AppSpecCalculation = {
  key: string;
  label: string;
  expression: string;
  inputFields: string[];
  outputField: string;
  precision?: number;
  dependencies: string[];
};

export type AppSpecBackendPlan = {
  required: boolean;
  authentication: string[];
  collections: Array<{
    key: string;
    fields: AppSpecField[];
    ownerScoped: boolean;
  }>;
  indexes: Array<{
    collection: string;
    fields: string[];
    order?: 'asc' | 'desc';
  }>;
  storage: string[];
  functions: string[];
  environmentVariables: string[];
};

export type ApplicationSpec = {
  schemaVersion: 1;
  projectKind: ProjectKind;
  title: string;
  summary: string;
  screens: AppSpecScreen[];
  entities: AppSpecEntity[];
  calculations: AppSpecCalculation[];
  globalActions: string[];
  dataDependencies: string[];
  acceptanceCriteria: string[];
  persistenceRequired: boolean;
  realTimeRequired: boolean;
  responsiveRequirements: string[];
  backend: AppSpecBackendPlan;
  forbiddenMarketingSections: string[];
};

export type WebsiteSection = {
  title: string;
  body: string;
};

/**
 * WebsitePlan remains the persisted planning envelope for backward
 * compatibility. appSpec is the binding implementation contract.
 */
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
  appSpec: ApplicationSpec;
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
