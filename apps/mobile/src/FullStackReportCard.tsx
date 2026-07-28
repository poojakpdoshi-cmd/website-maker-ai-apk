import './fullstack-report-card.css';

export type FullStackReport = {
  requested: boolean;
  ready: boolean;
  capabilities: {
    backendApi: boolean;
    database: boolean;
    migrations: boolean;
    authentication: boolean;
    authorization: boolean;
    writeOperations: boolean;
    environmentExample: boolean;
    setupDocumentation: boolean;
  };
  issues: string[];
};

type Props = {
  report?: FullStackReport | null;
};

const capabilityLabels: Array<
  [keyof FullStackReport['capabilities'], string]
> = [
  ['backendApi', 'Backend API'],
  ['database', 'Database'],
  ['migrations', 'Database migrations'],
  ['authentication', 'Authentication'],
  ['authorization', 'Admin authorization'],
  ['writeOperations', 'Data saving'],
  ['environmentExample', 'Environment setup'],
  ['setupDocumentation', 'Setup guide']
];

export function FullStackReportCard({
  report
}: Props) {
  if (!report || !report.requested) {
    return null;
  }

  return (
    <section
      className={`fullstack-report-card ${
        report.ready
          ? 'fullstack-report-ready'
          : 'fullstack-report-blocked'
      }`}
    >
      <header className="fullstack-report-header">
        <div>
          <p className="fullstack-report-eyebrow">
            FULL-STACK READINESS
          </p>

          <h3>
            {report.ready
              ? 'Backend & database ready'
              : 'Full-stack setup incomplete'}
          </h3>
        </div>

        <span className="fullstack-report-status">
          {report.ready ? 'READY' : 'BLOCKED'}
        </span>
      </header>

      <div className="fullstack-capability-grid">
        {capabilityLabels.map(([key, label]) => (
          <div
            className="fullstack-capability"
            key={key}
          >
            <span
              aria-hidden="true"
              className={
                report.capabilities[key]
                  ? 'capability-pass'
                  : 'capability-fail'
              }
            >
              {report.capabilities[key] ? '✓' : '×'}
            </span>

            <span>{label}</span>
          </div>
        ))}
      </div>

      {report.issues.length > 0 ? (
        <div className="fullstack-report-issues">
          <strong>Blocking issues</strong>

          <ul>
            {report.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
