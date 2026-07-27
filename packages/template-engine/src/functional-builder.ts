import type { WebsitePlan } from "../../shared/src/index";

function safeColour(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = safeColour(hex, "#111827").slice(1);
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      }[character]!)
  );
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 45) || "application"
  );
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function isFunctionalProject(plan: WebsitePlan): boolean {
  return !["marketing_website", "portfolio"].includes(plan.appSpec.projectKind);
}

export function createFunctionalAppSource(plan: WebsitePlan): string {
  const runtimeSpec = {
    projectKind: plan.appSpec.projectKind,
    title: plan.appSpec.title,
    summary: `A purpose-built ${titleCase(
      plan.appSpec.projectKind
    )} application.`,
    screens: plan.appSpec.screens,
    entities: plan.appSpec.entities,
    calculations: plan.appSpec.calculations,
    globalActions: plan.appSpec.globalActions,
    dataDependencies: plan.appSpec.dataDependencies,
    persistenceRequired: plan.appSpec.persistenceRequired,
    realTimeRequired: plan.appSpec.realTimeRequired,
  };
  const serialisedSpec = JSON.stringify(runtimeSpec, null, 2).replace(
    /<\//g,
    "<\\/"
  );

  return `import { useEffect, useMemo, useState } from 'react';
import './styles.css';
import {
  createRecord,
  deleteRecord,
  subscribeRecords,
  updateRecord
} from './services/dataStore.js';

const appSpec = ${serialisedSpec};
function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function calculateExpression(expression, values) {
  const tokens = String(expression)
    .replace(/([A-Za-z][A-Za-z0-9_]*)/g, (name) => String(numeric(values[name])))
    .match(/\\d+(?:\\.\\d+)?|[()+\\-*/]/g) || [];
  let position = 0;
  const primary = () => {
    const token = tokens[position++];
    if (token === '(') {
      const value = additive();
      if (tokens[position] === ')') position += 1;
      return value;
    }
    if (token === '-') return -primary();
    return numeric(token);
  };
  const multiplicative = () => {
    let value = primary();
    while (tokens[position] === '*' || tokens[position] === '/') {
      const operator = tokens[position++];
      const right = primary();
      value = operator === '*' ? value * right : right === 0 ? 0 : value / right;
    }
    return value;
  };
  const additive = () => {
    let value = multiplicative();
    while (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position++];
      const right = multiplicative();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  return additive();
}

function FieldInput({ field, value, onChange }) {
  const validationText = (field.validation || []).join(' ');
  const minimumLength = Number(validationText.match(/min(?:imum)?\\s*(?:length)?\\s*[:=]?\\s*(\\d+)/i)?.[1] || 0) || undefined;
  const maximumLength = Number(validationText.match(/max(?:imum)?\\s*(?:length)?\\s*[:=]?\\s*(\\d+)/i)?.[1] || 0) || undefined;
  const validation = { minLength: minimumLength, maxLength: maximumLength };
  if (field.type === 'boolean') {
    return <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />;
  }
  if (field.type === 'select' && field.options?.length) {
    return <select value={value ?? ''} required={field.required} {...validation} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select {field.label}</option>
      {field.options.map((option) => <option key={option}>{option}</option>)}
    </select>;
  }
  const type = ['number', 'currency', 'percentage'].includes(field.type)
    ? 'number'
    : field.type === 'date'
      ? 'date'
      : field.type === 'datetime'
        ? 'datetime-local'
        : field.type === 'email'
          ? 'email'
          : field.type === 'phone'
            ? 'tel'
            : field.type === 'url'
              ? 'url'
              : 'text';
  if (field.type === 'long_text') {
    return <textarea value={value ?? ''} required={field.required} {...validation} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input type={type} step={type === 'number' ? 'any' : undefined} value={value ?? ''} required={field.required} {...validation} onChange={(event) => onChange(event.target.value)} />;
}

function App() {
  const [screenKey, setScreenKey] = useState(appSpec.screens[0]?.key || '');
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [filterValues, setFilterValues] = useState({});
  const [modalAction, setModalAction] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutEmail, setCheckoutEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState('');
  const activeScreen = appSpec.screens.find((screen) => screen.key === screenKey) || appSpec.screens[0];
  const entity = appSpec.entities.find((item) => item.key === activeScreen?.entity) || appSpec.entities[0];
  const fields = entity?.fields || [];
  const columns = (activeScreen?.tableColumns?.length ? activeScreen.tableColumns : fields.map((field) => field.key))
    .map((key) => fields.find((field) => field.key === key))
    .filter(Boolean);
  const calculatedDraft = useMemo(() => {
    const next = { ...draft };
    for (const calculation of appSpec.calculations) {
      next[calculation.outputField] = calculateExpression(calculation.expression, next);
    }
    return next;
  }, [draft]);
  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const searched = term
      ? rows.filter((row) => fields.some((field) => String(row[field.key] ?? '').toLowerCase().includes(term)))
      : [...rows];
    const filtered = searched.filter((row) =>
      (activeScreen?.filters || []).every((filterName) => {
        const field = fields.find((item) => item.key === filterName || item.label.toLowerCase() === String(filterName).toLowerCase());
        const selected = field ? filterValues[field.key] : '';
        return !selected || String(row[field.key] ?? '') === selected;
      })
    );
    const requestedSort = String(activeScreen?.sorting?.[0] || '');
    const requestedSortKey = fields.find((field) =>
      requestedSort.toLowerCase().includes(field.key.toLowerCase()) ||
      requestedSort.toLowerCase().includes(field.label.toLowerCase())
    )?.key || '';
    const effectiveSortKey = sortKey || requestedSortKey;
    const descending = !sortKey && /\\bdesc(?:ending)?\\b/i.test(requestedSort);
    if (effectiveSortKey) {
      filtered.sort((left, right) => (descending ? -1 : 1) * String(left[effectiveSortKey] ?? '').localeCompare(
        String(right[effectiveSortKey] ?? ''),
        undefined,
        { numeric: true }
      ));
    }
    return filtered;
  }, [rows, search, sortKey, fields, filterValues, activeScreen]);

  useEffect(() => {
    if (!entity?.key) return undefined;
    return subscribeRecords(
      entity.key,
      (nextRows) => {
        setRows(nextRows);
        setOperationError('');
      },
      (error) => setOperationError(error.message)
    );
  }, [entity?.key]);

  async function submit(event) {
    event.preventDefault();
    if (!entity?.key || busy) return;
    setBusy(true);
    setOperationError('');
    try {
      if (editingId) {
        await updateRecord(entity.key, editingId, calculatedDraft);
      } else {
        await createRecord(entity.key, calculatedDraft);
      }
      setDraft({});
      setEditingId(null);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Could not save the record.');
    } finally {
      setBusy(false);
    }
  }

  function edit(row) {
    setDraft(row);
    setEditingId(row.id);
  }

  async function remove(id) {
    if (window.confirm('Delete this record? This action cannot be undone.')) {
      setBusy(true);
      setOperationError('');
      try {
        await deleteRecord(entity.key, id);
      } catch (error) {
        setOperationError(error instanceof Error ? error.message : 'Could not delete the record.');
      } finally {
        setBusy(false);
      }
    }
  }

  function exportCsv() {
    const header = columns.map((field) => field.label);
    const lines = [header, ...visibleRows.map((row) => columns.map((field) => row[field.key] ?? ''))]
      .map((line) => line.map((value) => '"' + String(value).replaceAll('"', '""') + '"').join(','));
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([lines.join('\\n')], { type: 'text/csv' }));
    link.download = entity?.key ? entity.key + '.csv' : 'export.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function addToCart(row) {
    setCart((current) => {
      const existing = current.find((item) => item.id === row.id);
      return existing
        ? current.map((item) => item.id === row.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { ...row, quantity: 1 }];
    });
  }

  async function checkout(event) {
    event.preventDefault();
    if (!cart.length || !checkoutEmail) return;
    const total = cart.reduce((sum, item) => sum + numeric(item.price) * item.quantity, 0);
    setBusy(true);
    setOperationError('');
    try {
      await createRecord('orders', {
        customer_email: checkoutEmail,
        total,
        status: 'Pending',
        created_at: new Date().toISOString()
      });
      setCart([]);
      setCartOpen(false);
      setCheckoutEmail('');
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Checkout failed.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="application-shell">
    <aside>
      <div className="app-brand">
        <img src="/logo.svg" alt="" />
        <div><strong>${escapeHtml(
          plan.businessName
        )}</strong><span>{appSpec.projectKind.replaceAll('_', ' ')}</span></div>
      </div>
      <nav aria-label="Application screens">
        {appSpec.screens.map((screen) => <button key={screen.key} className={screen.key === screenKey ? 'active' : ''} onClick={() => setScreenKey(screen.key)}>{screen.title}</button>)}
      </nav>
      <p className="persistence-note">{appSpec.persistenceRequired ? 'Connected to the verified project backend.' : 'This application does not require server persistence.'}</p>
    </aside>
    <main>
      <header className="app-header">
        <div><span className="eyebrow">{appSpec.projectKind.replaceAll('_', ' ')}</span><h1>{activeScreen?.title || appSpec.title}</h1><p>{activeScreen?.purpose || appSpec.summary}</p></div>
        <div>{appSpec.projectKind === 'ecommerce_application' && <button type="button" className="cart-button" onClick={() => setCartOpen(true)}>Cart ({cart.reduce((sum, item) => sum + item.quantity, 0)})</button>}<span className="record-count">{rows.length} records</span></div>
      </header>

      {(activeScreen?.kind === 'dashboard' || appSpec.projectKind === 'admin_panel') && <section className="metrics" aria-label="Summary">
        <article><span>Total records</span><strong>{rows.length}</strong></article>
        <article><span>Visible results</span><strong>{visibleRows.length}</strong></article>
        <article><span>Required fields</span><strong>{fields.filter((field) => field.required).length}</strong></article>
      </section>}

      {entity && <section className="workspace">
        {operationError && <p className="operation-error" role="alert">{operationError}</p>}
        <div className="toolbar">
          {activeScreen?.search && <label className="search"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search records" /></label>}
          {(activeScreen?.filters || []).map((filterName) => {
            const field = fields.find((item) => item.key === filterName || item.label.toLowerCase() === String(filterName).toLowerCase());
            if (!field) return null;
            const options = [...new Set(rows.map((row) => String(row[field.key] ?? '')).filter(Boolean))];
            return <label key={filterName}><span>{field.label}</span><select value={filterValues[field.key] || ''} onChange={(event) => setFilterValues((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">All</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
          })}
          {activeScreen?.sorting?.length > 0 && <label><span>Sort by</span><select value={sortKey} onChange={(event) => setSortKey(event.target.value)}><option value="">Default order</option>{columns.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>}
          {activeScreen?.exportActions?.length > 0 && <button type="button" onClick={exportCsv}>Export CSV</button>}
          {(activeScreen?.modalActions || []).map((action) => <button type="button" key={action} onClick={() => setModalAction(action)}>{action}</button>)}
        </div>

        {(activeScreen?.formFields?.length > 0 || appSpec.projectKind === 'calculator') && <form className="record-form" onSubmit={submit}>
          <div className="form-heading"><h2>{appSpec.projectKind === 'calculator' ? 'Inputs' : editingId ? 'Edit record' : 'Add record'}</h2>{editingId && <button type="button" onClick={() => { setDraft({}); setEditingId(null); }}>Cancel</button>}</div>
          <div className="form-grid">
            {fields.filter((field) => !appSpec.calculations.some((calculation) => calculation.outputField === field.key)).map((field) => <label key={field.key}><span>{field.label}{field.required ? ' *' : ''}</span><FieldInput field={field} value={draft[field.key]} onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))} /></label>)}
          </div>
          {appSpec.calculations.length > 0 && <div className="calculation-results">{appSpec.calculations.map((calculation) => <article key={calculation.key}><span>{calculation.label}</span><strong>{numeric(calculatedDraft[calculation.outputField]).toFixed(calculation.precision ?? 2)}</strong><small>{calculation.expression}</small></article>)}</div>}
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : appSpec.projectKind === 'calculator' ? 'Save calculation' : editingId ? 'Save changes' : 'Create record'}</button>
        </form>}

        <div className="table-card">
          <div className="table-scroll"><table><thead><tr>{columns.map((field) => <th key={field.key}>{field.label}</th>)}{activeScreen?.actions?.some((action) => /edit|delete|view/i.test(action)) && <th>Actions</th>}</tr></thead><tbody>
            {visibleRows.map((row) => <tr key={row.id}>{columns.map((field) => <td key={field.key}>{String(row[field.key] ?? '—')}</td>)}{activeScreen?.actions?.some((action) => /edit|delete|view|cart/i.test(action)) && <td className="row-actions">{activeScreen.actions.some((action) => /cart/i.test(action)) && <button disabled={busy} onClick={() => addToCart(row)}>Add to cart</button>}{activeScreen.actions.some((action) => /view/i.test(action)) && <button disabled={busy} onClick={() => setSelectedRecord(row)}>View</button>}{activeScreen.actions.some((action) => /edit/i.test(action)) && <button disabled={busy} onClick={() => edit(row)}>Edit</button>}{activeScreen.actions.some((action) => /delete/i.test(action)) && <button disabled={busy} className="danger" onClick={() => void remove(row.id)}>Delete</button>}</td>}</tr>)}
            {!visibleRows.length && <tr><td colSpan={columns.length + 1} className="empty-state">No records yet. Use the form to create the first one.</td></tr>}
          </tbody></table></div>
        </div>
      </section>}
      {cartOpen && <div className="modal-backdrop" role="presentation" onClick={() => setCartOpen(false)}><form className="application-modal" role="dialog" aria-modal="true" aria-label="Checkout" onSubmit={checkout} onClick={(event) => event.stopPropagation()}><h2>Checkout</h2>{cart.map((item) => <p key={item.id}>{String(item.name || 'Product')} × {item.quantity}</p>)}<p><strong>Total:</strong> {cart.reduce((sum, item) => sum + numeric(item.price) * item.quantity, 0).toFixed(2)}</p><label>Email<input type="email" value={checkoutEmail} onChange={(event) => setCheckoutEmail(event.target.value)} required /></label><button type="submit" disabled={busy || !cart.length}>{busy ? 'Processing…' : 'Confirm checkout'}</button><button type="button" onClick={() => setCartOpen(false)}>Close</button></form></div>}
      {selectedRecord && <div className="modal-backdrop" role="presentation" onClick={() => setSelectedRecord(null)}><section className="application-modal" role="dialog" aria-modal="true" aria-label="Record details" onClick={(event) => event.stopPropagation()}><h2>{entity?.label || 'Record'} details</h2>{fields.map((field) => <p key={field.key}><strong>{field.label}:</strong> {String(selectedRecord[field.key] ?? '—')}</p>)}<button type="button" onClick={() => setSelectedRecord(null)}>Close</button></section></div>}
      {modalAction && <div className="modal-backdrop" role="presentation" onClick={() => setModalAction('')}><section className="application-modal" role="dialog" aria-modal="true" aria-label={modalAction} onClick={(event) => event.stopPropagation()}><h2>{modalAction}</h2><p>Complete this action for the selected {entity?.label || 'record'}.</p><button type="button" onClick={() => setModalAction('')}>Close</button></section></div>}
    </main>
  </div>;
}

export default App;
`;
}

export function createFunctionalStyles(plan: WebsitePlan): string {
  const primary = safeColour(plan.theme.primary, "#06b6d4");
  const secondary = safeColour(plan.theme.secondary, "#8b5cf6");
  const background = safeColour(plan.theme.background, "#071018");
  const text = safeColour(plan.theme.text, "#f8fafc");
  return `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:${text};background:${background};font-synthesis:none;--primary:${primary};--secondary:${secondary};--bg:${background};--text:${text};--muted:${rgba(
    text,
    0.66
  )};--line:${rgba(text, 0.13)};--surface:${rgba(
    text,
    0.055
  )};--surface-strong:${rgba(
    text,
    0.09
  )}}*{box-sizing:border-box}body{margin:0;min-width:320px;background:radial-gradient(circle at 80% 0,${rgba(
    primary,
    0.16
  )},transparent 32%),var(--bg);color:var(--text)}button,input,textarea,select{font:inherit}.application-shell{min-height:100vh;display:grid;grid-template-columns:260px minmax(0,1fr)}aside{position:sticky;top:0;height:100vh;padding:24px 18px;border-right:1px solid var(--line);background:${rgba(
    background,
    0.88
  )};backdrop-filter:blur(20px);display:flex;flex-direction:column;gap:28px}.app-brand{display:flex;align-items:center;gap:12px}.app-brand img{width:42px;height:42px;border-radius:13px}.app-brand div{display:grid;gap:3px}.app-brand span,.persistence-note{font-size:12px;color:var(--muted);text-transform:capitalize}aside nav{display:grid;gap:7px}aside nav button,.toolbar button,.row-actions button,.form-heading button{border:0;background:transparent;color:var(--muted);text-align:left;padding:11px 12px;border-radius:10px;cursor:pointer}button:disabled{opacity:.55;cursor:not-allowed}aside nav button.active{background:${rgba(
    primary,
    0.18
  )};color:var(--text);box-shadow:inset 3px 0 var(--primary)}.persistence-note{margin-top:auto;padding:12px;border:1px solid var(--line);border-radius:12px;line-height:1.5}main{width:min(1500px,100%);padding:clamp(22px,4vw,54px);overflow:hidden}.app-header{display:flex;justify-content:space-between;gap:28px;align-items:flex-start;margin-bottom:30px}.app-header h1{font-size:clamp(34px,5vw,64px);line-height:1;margin:10px 0 14px;letter-spacing:-.04em}.app-header p{color:var(--muted);max-width:720px;line-height:1.6}.eyebrow{text-transform:uppercase;letter-spacing:.16em;font-size:11px;font-weight:800;color:var(--primary)}.record-count{padding:9px 13px;border:1px solid var(--line);border-radius:999px;color:var(--muted);white-space:nowrap}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}.metrics article,.record-form,.table-card{border:1px solid var(--line);background:var(--surface);border-radius:18px}.metrics article{padding:20px;display:grid;gap:12px}.metrics span{color:var(--muted);font-size:13px}.metrics strong{font-size:34px}.workspace{display:grid;gap:16px}.operation-error{margin:0;padding:12px 14px;border:1px solid rgba(244,63,94,.4);border-radius:12px;background:rgba(244,63,94,.1);color:#fb7185}.toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.toolbar label,.record-form label{display:grid;gap:7px;color:var(--muted);font-size:12px}.toolbar input,.toolbar select,.record-form input,.record-form textarea,.record-form select{min-height:44px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--surface);color:var(--text);outline:none}.toolbar input:focus,.toolbar select:focus,.record-form input:focus,.record-form textarea:focus,.record-form select:focus{border-color:var(--primary);box-shadow:0 0 0 3px ${rgba(
    primary,
    0.15
  )}}.toolbar .search{flex:1;min-width:220px}.toolbar button{border:1px solid var(--line);color:var(--text)}.record-form{padding:22px}.form-heading{display:flex;justify-content:space-between;align-items:center}.form-heading h2{margin:0 0 18px}.form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.record-form textarea{min-height:94px;resize:vertical}.record-form input[type=checkbox]{width:24px;min-height:24px}.primary{margin-top:18px;border:0;border-radius:11px;padding:12px 17px;background:var(--primary);color:white;font-weight:800;cursor:pointer}.calculation-results{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:18px}.calculation-results article{padding:15px;border-radius:13px;background:${rgba(
    secondary,
    0.12
  )};display:grid;gap:7px}.calculation-results span,.calculation-results small{color:var(--muted)}.calculation-results strong{font-size:28px}.table-card{overflow:hidden}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;min-width:680px}th,td{text-align:left;padding:14px 16px;border-bottom:1px solid var(--line)}th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}td{font-size:14px}.row-actions{display:flex;gap:7px}.row-actions button{padding:7px 9px;border:1px solid var(--line);color:var(--text)}.row-actions .danger{color:#fb7185}.empty-state{text-align:center;color:var(--muted);padding:42px}.modal-backdrop{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.68)}.application-modal{width:min(520px,100%);padding:28px;border:1px solid var(--line);border-radius:18px;background:var(--bg);box-shadow:0 30px 90px rgba(0,0,0,.35)}@media(max-width:900px){.application-shell{grid-template-columns:1fr}aside{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line);padding:15px}aside nav{display:flex;overflow-x:auto}.persistence-note{margin:0}.form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){main{padding:20px 14px}.app-header{display:grid}.metrics{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.record-count{justify-self:start}}`;
}

export function createFunctionalPreviewHtml(
  plan: WebsitePlan,
  logoSvg: string
): string {
  const spec = plan.appSpec;
  const entity = spec.entities[0];
  const screen = spec.screens[0];
  const fields = entity?.fields || [];
  const columns = (
    screen?.tableColumns?.length
      ? screen.tableColumns
      : fields.map((field) => field.key)
  )
    .map((key) => fields.find((field) => field.key === key))
    .filter((field): field is NonNullable<typeof field> => Boolean(field));
  const styles = createFunctionalStyles(plan);
  const inputMarkup = fields
    .filter(
      (field) =>
        !spec.calculations.some((item) => item.outputField === field.key)
    )
    .map(
      (field) =>
        `<label><span>${escapeHtml(field.label)}${
          field.required ? " *" : ""
        }</span><input name="${escapeHtml(field.key)}" ${
          field.required ? "required" : ""
        } type="${
          ["number", "currency", "percentage"].includes(field.type)
            ? "number"
            : field.type === "date"
            ? "date"
            : field.type === "email"
            ? "email"
            : "text"
        }"></label>`
    )
    .join("");
  const formulaMarkup = spec.calculations
    .map(
      (item) =>
        `<article><span>${escapeHtml(
          item.label
        )}</span><strong data-calculation="${escapeHtml(
          item.key
        )}">0.00</strong><small>${escapeHtml(
          item.expression
        )}</small></article>`
    )
    .join("");
  const navigation = spec.screens
    .map(
      (item, index) =>
        `<span class="${index === 0 ? "active" : ""}">${escapeHtml(
          item.title
        )}</span>`
    )
    .join("");
  const formulaRuntime = spec.calculations.length
    ? `<script>(()=>{const calculations=${JSON.stringify(
        spec.calculations
      ).replace(
        /<\//g,
        "<\\/"
      )};const numeric=(value)=>Number.isFinite(Number(value))?Number(value):0;const evaluate=(expression,values)=>{const tokens=String(expression).replace(/([A-Za-z][A-Za-z0-9_]*)/g,(name)=>String(numeric(values[name]))).match(/\\d+(?:\\.\\d+)?|[()+\\-*/]/g)||[];let position=0;const primary=()=>{const token=tokens[position++];if(token==='('){const value=additive();if(tokens[position]===')')position+=1;return value}if(token==='-')return-primary();return numeric(token)};const multiply=()=>{let value=primary();while(tokens[position]==='*'||tokens[position]==='/'){const operator=tokens[position++];const right=primary();value=operator==='*'?value*right:right===0?0:value/right}return value};const additive=()=>{let value=multiply();while(tokens[position]==='+'||tokens[position]==='-'){const operator=tokens[position++];const right=multiply();value=operator==='+'?value+right:value-right}return value};return additive()};const form=document.getElementById('record-form');const update=()=>{const values=Object.fromEntries(new FormData(form).entries());for(const calculation of calculations){const result=evaluate(calculation.expression,values);values[calculation.outputField]=result;let hidden=form.querySelector('[data-calculation-output="'+calculation.key+'"]');if(!hidden){hidden=document.createElement('input');hidden.type='hidden';hidden.name=calculation.outputField;hidden.dataset.calculationOutput=calculation.key;form.append(hidden)}hidden.value=String(result);const display=form.querySelector('[data-calculation="'+calculation.key+'"]');if(display)display.textContent=numeric(result).toFixed(calculation.precision??2)}};form.addEventListener('input',update);update()})()</script>`
    : "";
  const form =
    screen?.formFields?.length || spec.projectKind === "calculator"
      ? `<form class="record-form" id="record-form"><div class="form-heading"><h2>${
          spec.projectKind === "calculator" ? "Inputs" : "Add record"
        }</h2></div><div class="form-grid">${inputMarkup}</div>${
          formulaMarkup
            ? `<div class="calculation-results">${formulaMarkup}</div>`
            : ""
        }<button class="primary">${
          spec.projectKind === "calculator"
            ? "Save calculation"
            : "Create record"
        }</button></form>${formulaRuntime}`
      : "";
  const dashboard =
    screen?.kind === "dashboard" || spec.projectKind === "admin_panel"
      ? `<section class="metrics"><article><span>Total records</span><strong id="metric-total">0</strong></article><article><span>Visible results</span><strong id="metric-visible">0</strong></article><article><span>Required fields</span><strong>${
          fields.filter((field) => field.required).length
        }</strong></article></section>`
      : "";
  const search = screen?.search
    ? '<label class="search"><span>Search</span><input id="search" placeholder="Search records"></label>'
    : "";
  const exportButton = screen?.exportActions?.length
    ? '<button id="export" type="button">Export CSV</button>'
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(
    plan.businessName
  )}</title><meta name="description" content="${escapeHtml(
    spec.summary
  )}"><style>${styles}</style></head><body><div class="application-shell"><aside><div class="app-brand"><img src="data:image/svg+xml,${encodeURIComponent(
    logoSvg
  )}" alt=""><div><strong>${escapeHtml(
    plan.businessName
  )}</strong><span>${escapeHtml(
    titleCase(spec.projectKind)
  )}</span></div></div><nav>${navigation}</nav><p class="persistence-note">${
    spec.persistenceRequired
      ? "Preview storage is local. Publishing requires a verified backend."
      : "Changes are saved on this device."
  }</p></aside><main><header class="app-header"><div><span class="eyebrow">${escapeHtml(
    titleCase(spec.projectKind)
  )}</span><h1>${escapeHtml(screen?.title || spec.title)}</h1><p>${escapeHtml(
    screen?.purpose || spec.summary
  )}</p></div><span class="record-count"><b id="record-count">0</b> records</span></header>${dashboard}<section class="workspace"><div class="toolbar">${search}${exportButton}</div>${form}<div class="table-card"><div class="table-scroll"><table><thead><tr>${columns
    .map((field) => `<th>${escapeHtml(field.label)}</th>`)
    .join("")}<th>Actions</th></tr></thead><tbody id="rows"><tr><td colspan="${
    columns.length + 1
  }" class="empty-state">No records yet. Use the form to create the first one.</td></tr></tbody></table></div></div></section></main></div><script>const key=${JSON.stringify(
    `nexora-preview-${slugify(plan.businessName)}`
  )};const fields=${JSON.stringify(
    columns.map((field) => field.key)
  )};let rows=JSON.parse(localStorage.getItem(key)||'[]');const body=document.getElementById('rows');const render=()=>{const term=(document.getElementById('search')?.value||'').toLowerCase();const visible=rows.filter(r=>fields.some(f=>String(r[f]??'').toLowerCase().includes(term)));document.getElementById('record-count').textContent=rows.length;document.getElementById('metric-total')&&(document.getElementById('metric-total').textContent=rows.length);document.getElementById('metric-visible')&&(document.getElementById('metric-visible').textContent=visible.length);body.innerHTML=visible.length?visible.map(r=>'<tr>'+fields.map(f=>'<td>'+String(r[f]??'—').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</td>').join('')+'<td><button data-delete="'+r.id+'">Delete</button></td></tr>').join(''):'<tr><td colspan="${
    columns.length + 1
  }" class="empty-state">No matching records.</td></tr>';};document.getElementById('record-form')?.addEventListener('submit',e=>{e.preventDefault();const record=Object.fromEntries(new FormData(e.target).entries());record.id=crypto.randomUUID();rows.push(record);localStorage.setItem(key,JSON.stringify(rows));e.target.reset();render()});body.addEventListener('click',e=>{const id=e.target.dataset.delete;if(id&&confirm('Delete this record?')){rows=rows.filter(r=>r.id!==id);localStorage.setItem(key,JSON.stringify(rows));render()}});document.getElementById('search')?.addEventListener('input',render);document.getElementById('export')?.addEventListener('click',()=>{const lines=[fields.join(','),...rows.map(r=>fields.map(f=>JSON.stringify(r[f]??'')).join(','))];const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([lines.join('\\n')],{type:'text/csv'}));a.download='export.csv';a.click();URL.revokeObjectURL(a.href)});render();</script></body></html>`;
}
