import type { ApplicationSpec, GeneratedProjectFile } from "@wmai/shared";

export type RequirementFinding = {
  requirement: string;
  severity: "error" | "warning";
  message: string;
  evidence?: string;
};

export type RequirementValidationResult = {
  passed: boolean;
  findings: RequirementFinding[];
  checks: Record<string, boolean>;
};

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9.%+*/() -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceWithoutManifest(files: GeneratedProjectFile[]): string {
  return files
    .filter((file) => file.path !== "nexora.appspec.json")
    .map((file) => file.content)
    .join("\n");
}

function includesTerm(
  source: string,
  ...values: Array<string | undefined>
): boolean {
  const normalizedSource = normalized(source);
  return values
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizedSource.includes(normalized(value)));
}

function parseManifest(files: GeneratedProjectFile[]): ApplicationSpec | null {
  const content = files.find(
    (file) => file.path === "nexora.appspec.json"
  )?.content;
  if (!content) return null;
  try {
    return JSON.parse(content) as ApplicationSpec;
  } catch {
    return null;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function validateAppSpecRequirements(
  appSpec: ApplicationSpec,
  files: GeneratedProjectFile[]
): RequirementValidationResult {
  const findings: RequirementFinding[] = [];
  const checks: Record<string, boolean> = {};
  const source = sourceWithoutManifest(files);
  const dynamicTableBinding =
    /columns\.map\s*\(|tableColumns.*\.map\s*\(|fields\.map\s*\([^)]*=>\s*<th/s.test(
      source
    ) && /<th|createElement\(['"]th/i.test(source);
  const dynamicFormBinding =
    /formFields.*\.map\s*\(|fields\.filter\s*\([^)]*\).*\.map\s*\(|<FieldInput/s.test(
      source
    ) && /<form|onSubmit/i.test(source);
  const manifest = parseManifest(files);

  checks.bindingManifestPresent = Boolean(manifest);
  if (!manifest) {
    findings.push({
      requirement: "appSpec",
      severity: "error",
      message: "Binding application specification file is missing or invalid.",
    });
  } else if (stableJson(manifest) !== stableJson(appSpec)) {
    checks.bindingManifestMatches = false;
    findings.push({
      requirement: "appSpec",
      severity: "error",
      message:
        "Generated files changed or omitted part of the binding application specification.",
    });
  } else {
    checks.bindingManifestMatches = true;
  }

  const entityMap = new Map(
    appSpec.entities.map((entity) => [entity.key, entity])
  );
  let screensPassed = true;
  for (const screen of appSpec.screens) {
    if (!includesTerm(source, screen.title, screen.key)) {
      screensPassed = false;
      findings.push({
        requirement: `screen:${screen.key}`,
        severity: "error",
        message: `Required screen is missing: ${screen.title}.`,
      });
    }
    const entity = screen.entity ? entityMap.get(screen.entity) : undefined;
    for (const columnKey of screen.tableColumns || []) {
      const field = entity?.fields.find((item) => item.key === columnKey);
      if (
        !field ||
        !includesTerm(source, field.key, field.label) ||
        !dynamicTableBinding
      ) {
        findings.push({
          requirement: `column:${screen.key}:${columnKey}`,
          severity: "error",
          message: `Required table column is missing from ${screen.title}: ${
            field?.label || columnKey
          }.`,
        });
      }
    }
    for (const fieldKey of screen.formFields || []) {
      const field = entity?.fields.find((item) => item.key === fieldKey);
      if (
        !field ||
        !includesTerm(source, field.key, field.label) ||
        !dynamicFormBinding
      ) {
        findings.push({
          requirement: `form:${screen.key}:${fieldKey}`,
          severity: "error",
          message: `Required form field is missing from ${screen.title}: ${
            field?.label || fieldKey
          }.`,
        });
      }
    }
  }
  checks.requiredScreens = screensPassed;

  let calculationsPassed = true;
  const calculationEnginePresent =
    /calculateExpression|evaluateFormula|calculation\.expression|calculations\.map/s.test(
      source
    ) && /useMemo|onChange|addEventListener\(['"]input/i.test(source);
  for (const calculation of appSpec.calculations) {
    const expressionPresent = source.includes(calculation.expression);
    const outputPresent = includesTerm(
      source,
      calculation.outputField,
      calculation.label
    );
    const inputsPresent = calculation.inputFields.every((field) =>
      includesTerm(source, field)
    );
    if (
      !expressionPresent ||
      !outputPresent ||
      !inputsPresent ||
      !calculationEnginePresent
    ) {
      calculationsPassed = false;
      findings.push({
        requirement: `calculation:${calculation.key}`,
        severity: "error",
        message: `Required formula is missing or incomplete: ${calculation.label} = ${calculation.expression}.`,
      });
    }
  }
  checks.requiredCalculations = calculationsPassed;

  let relationshipsPassed = true;
  for (const entity of appSpec.entities) {
    for (const relationship of entity.relationships) {
      const implemented =
        includesTerm(source, entity.key, relationship.targetEntity) &&
        /relatedRecords|referenceOptions|relationshipOptions|loadRelated|foreignKey|belongsTo|hasMany/s.test(
          source
        );
      if (!implemented) {
        relationshipsPassed = false;
        findings.push({
          requirement: `relationship:${entity.key}:${relationship.targetEntity}`,
          severity: "error",
          message: `Required ${relationship.type} relationship from ${entity.label} to ${relationship.targetEntity} is missing.`,
        });
      }
    }
  }
  checks.requiredRelationships = relationshipsPassed;

  const customValidations = appSpec.entities.flatMap((entity) =>
    entity.fields.flatMap((field) =>
      (field.validation || []).map((validation) => ({
        entity: entity.label,
        field: field.label,
        validation,
      }))
    )
  );
  checks.customValidations =
    customValidations.length === 0 ||
    /validate|validation|pattern=|minLength|maxLength|min=|max=/i.test(source);
  if (!checks.customValidations) {
    for (const item of customValidations) {
      findings.push({
        requirement: `validation:${item.entity}:${item.field}`,
        severity: "error",
        message: `Custom validation is not implemented for ${item.field}: ${item.validation}.`,
      });
    }
  }

  const requiredActions = [
    ...appSpec.globalActions,
    ...appSpec.screens.flatMap((screen) => screen.actions),
  ];
  const needsCreate = requiredActions.some((action) =>
    /create|add/i.test(action)
  );
  const needsEdit = requiredActions.some((action) =>
    /edit|update/i.test(action)
  );
  const needsDelete = requiredActions.some((action) =>
    /delete|remove/i.test(action)
  );
  const needsView = requiredActions.some((action) =>
    /view|detail/i.test(action)
  );
  const needsSearch = appSpec.screens.some((screen) => screen.search);
  const needsSort = appSpec.screens.some((screen) => screen.sorting.length > 0);
  const needsExport = appSpec.screens.some(
    (screen) => screen.exportActions.length > 0
  );
  const needsFilter = appSpec.screens.some(
    (screen) => screen.filters.length > 0
  );
  const needsModal = appSpec.screens.some(
    (screen) => screen.modalActions.length > 0
  );
  const needsCart = requiredActions.some((action) =>
    /add to cart|cart/i.test(action)
  );
  const needsCheckout = requiredActions.some((action) =>
    /checkout/i.test(action)
  );

  const actionChecks: Array<[boolean, boolean, string, string]> = [
    [
      needsCreate,
      /onSubmit|addEventListener\(['"]submit|method:\s*['"]POST/i.test(source),
      "create",
      "Create action is decorative or missing.",
    ],
    [
      needsEdit,
      /setEditing|editingId|method:\s*['"](?:PATCH|PUT)/i.test(source),
      "edit",
      "Edit action is decorative or missing.",
    ],
    [
      needsDelete,
      /confirm\s*\(|method:\s*['"]DELETE|filter\s*\(/i.test(source),
      "delete",
      "Delete action is decorative or missing.",
    ],
    [
      needsView,
      /setSelectedRecord|record details|detailModal|viewRecord/i.test(source),
      "view",
      "View/details action is decorative or missing.",
    ],
    [
      needsSearch,
      /toLowerCase\(\).*includes|includes\(term\)|searchParams/i.test(source),
      "search",
      "Search behavior is missing.",
    ],
    [
      needsSort,
      /\.sort\s*\(|order\(/i.test(source),
      "sorting",
      "Sorting behavior is missing.",
    ],
    [
      needsExport,
      /text\/csv|Blob\s*\(|download\s*=/i.test(source),
      "export",
      "Export action is decorative or missing.",
    ],
    [
      needsFilter,
      /activeFilter|filterValues|filters\.map|filter-controls|searchParams\.get/i.test(
        source
      ),
      "filter",
      "Requested filters are missing or decorative.",
    ],
    [
      needsModal,
      /role=['"]dialog|aria-modal|<dialog|setModal|openModal/i.test(source),
      "modal",
      "Requested modal behavior is missing or decorative.",
    ],
    [
      needsCart,
      /addToCart|setCart\s*\(/i.test(source),
      "cart",
      "Shopping cart behavior is missing or decorative.",
    ],
    [
      needsCheckout,
      /async function checkout|confirm checkout|createRecord\(['"]orders/i.test(
        source
      ),
      "checkout",
      "Checkout behavior is missing or decorative.",
    ],
  ];
  for (const [required, implemented, requirement, message] of actionChecks) {
    if (required && !implemented) {
      findings.push({
        requirement: `action:${requirement}`,
        severity: "error",
        message,
      });
    }
    checks[`action_${requirement}`] = !required || implemented;
  }

  if (appSpec.dataDependencies.length > 0 || appSpec.calculations.length > 0) {
    const reactive =
      /useMemo|useEffect|onChange|addEventListener\(['"]input/i.test(source);
    checks.reactiveDependencies = reactive;
    if (!reactive) {
      findings.push({
        requirement: "data_dependencies",
        severity: "error",
        message:
          "Requested data dependencies do not update when their inputs change.",
      });
    }
  }

  if (appSpec.realTimeRequired) {
    const realTime = /onSnapshot|WebSocket|EventSource|subscribe\s*\(/i.test(
      source
    );
    checks.realTimeUpdates = realTime;
    if (!realTime) {
      findings.push({
        requirement: "real_time",
        severity: "error",
        message:
          "Real-time behavior was requested but no real subscription implementation was generated.",
      });
    }
  }

  if (appSpec.persistenceRequired) {
    const persistence =
      /localStorage|indexedDB|firebase|firestore|fetch\s*\(/i.test(source);
    checks.persistenceImplementation = persistence;
    if (!persistence) {
      findings.push({
        requirement: "persistence",
        severity: "error",
        message: "Required persistence is missing.",
      });
    }
  }

  const requestedAuthProviders = appSpec.backend.authentication;
  if (requestedAuthProviders.length > 0) {
    const interactiveAuthentication =
      /signInWithEmailAndPassword|signInWithPopup|createUserWithEmailAndPassword|auth\/login/i.test(
        source
      ) &&
      /type=['"]password|password.*<FieldInput|password.*<input/is.test(source);
    checks.authenticationImplementation =
      interactiveAuthentication &&
      requestedAuthProviders.every(
        (provider) =>
          /authenticated users?|login|sign[ -]?in/i.test(provider) ||
          includesTerm(source, provider)
      );
    if (!checks.authenticationImplementation) {
      findings.push({
        requirement: "backend:authentication",
        severity: "error",
        message: `Requested authentication is missing or incomplete: ${requestedAuthProviders.join(
          ", "
        )}.`,
      });
    }
  }

  if (appSpec.backend.storage.length > 0) {
    const storage =
      /firebase\/storage|getStorage\s*\(|uploadBytes|uploadString|type=['"]file|new FormData\s*\(/i.test(
        source
      );
    checks.storageImplementation =
      storage &&
      appSpec.backend.storage.every((resource) =>
        includesTerm(source, resource)
      );
    if (!checks.storageImplementation) {
      findings.push({
        requirement: "backend:storage",
        severity: "error",
        message: `Requested upload/storage behavior is missing: ${appSpec.backend.storage.join(
          ", "
        )}.`,
      });
    }
  }

  if (appSpec.backend.functions.length > 0) {
    const backendFiles = files.filter((file) =>
      /^(api|server|functions|src\/server|src\/api)\//i.test(file.path)
    );
    const backendSource = backendFiles.map((file) => file.content).join("\n");
    const secureEndpoint =
      /app\.(?:get|post|put|patch|delete)\s*\(|onRequest\s*\(|export\s+(?:async\s+)?function|functions\.https|new Hono|Router\s*\(/i.test(
        backendSource
      );
    checks.secureFunctionsImplementation =
      secureEndpoint &&
      appSpec.backend.functions.every((operation) =>
        includesTerm(backendSource, operation)
      );
    if (!checks.secureFunctionsImplementation) {
      findings.push({
        requirement: "backend:functions",
        severity: "error",
        message: `Requested secure server operation is missing: ${appSpec.backend.functions.join(
          ", "
        )}.`,
      });
    }
  }

  if (appSpec.projectKind !== "marketing_website") {
    const forbiddenSource = files
      .filter((file) => /^(src\/App|src\/components)/.test(file.path))
      .map((file) => normalized(file.content))
      .join("\n");
    for (const forbidden of appSpec.forbiddenMarketingSections) {
      if (forbiddenSource.includes(normalized(forbidden))) {
        findings.push({
          requirement: "project_classification",
          severity: "error",
          message: `Unrequested marketing section was generated for a functional project: ${forbidden}.`,
        });
      }
    }
    checks.noUnrequestedMarketingSections = !findings.some(
      (finding) => finding.requirement === "project_classification"
    );
  }

  const styles =
    files.find((file) => file.path === "src/styles.css")?.content || "";
  checks.mobileLayout =
    /@media/.test(styles) &&
    /overflow-x|overflow:auto|min-width:320|grid-template-columns:1fr/.test(
      styles
    );
  if (!checks.mobileLayout) {
    findings.push({
      requirement: "responsive_layout",
      severity: "error",
      message: "Mobile layout requirements are not implemented.",
    });
  }

  return {
    passed: !findings.some((finding) => finding.severity === "error"),
    findings,
    checks,
  };
}
