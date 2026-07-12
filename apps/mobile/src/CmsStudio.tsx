import {
  FormEvent,
  useEffect,
  useMemo,
  useState
} from 'react';

type CmsProject = {
  id: string;
  name: string;
  website_type?: string;
  production_url?: string | null;
};

type CmsDocument = {
  id: string;
  project_id: string;
  collection:
    | 'pages'
    | 'products'
    | 'blog'
    | 'services'
    | 'testimonials'
    | 'faqs'
    | 'navigation'
    | 'settings';
  slug: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
  content: Record<string, unknown>;
  seo: Record<string, unknown>;
  sort_order: number;
  published_at?: string | null;
  updated_at?: string;
};

type CmsSettings = {
  project_id: string;
  enabled: boolean;
  public_slug: string;
  content_version: number;
};

type CmsResponse = {
  project: {
    id: string;
    name: string;
  };
  settings: CmsSettings | null;
  documents: CmsDocument[];
};

type CmsRevision = {
  id: string;
  version_number: number;
  change_note?: string | null;
  created_at: string;
  snapshot: Record<string, unknown>;
};


type CmsStudioProps = {
  apiBase: string;
  email: string;
  token: string;
  installationId: string;
  projects: CmsProject[];
};

const collections = [
  'pages',
  'products',
  'blog',
  'services',
  'testimonials',
  'faqs',
  'navigation',
  'settings'
] as const;

function createSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export default function CmsStudio({
  apiBase,
  email,
  token,
  installationId,
  projects
}: CmsStudioProps) {
  const [projectId, setProjectId] =
    useState('');

  const [settings, setSettings] =
    useState<CmsSettings | null>(null);

  const [documents, setDocuments] =
    useState<CmsDocument[]>([]);

  const [activeCollection, setActiveCollection] =
    useState<(typeof collections)[number]>('pages');

  const [selectedId, setSelectedId] =
    useState<string | null>(null);

  const [revisions, setRevisions] =
    useState<CmsRevision[]>([]);

  const [revisionLoading, setRevisionLoading] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState('');

  const [error, setError] =
    useState('');

  const [title, setTitle] =
    useState('');

  const [slug, setSlug] =
    useState('');

  const [status, setStatus] =
    useState<'draft' | 'published'>('draft');

  const [contentText, setContentText] =
    useState('{\n  "heading": "",\n  "description": ""\n}');

  const [seoTitle, setSeoTitle] =
    useState('');

  const [seoDescription, setSeoDescription] =
    useState('');

  const selectedDocument = useMemo(
    () =>
      documents.find(
        (document) => document.id === selectedId
      ) || null,
    [documents, selectedId]
  );

  const visibleDocuments = useMemo(
    () =>
      documents.filter(
        (document) =>
          document.collection === activeCollection
      ),
    [documents, activeCollection]
  );

  function headers() {
    return {
      Authorization: `Bearer ${token}`,
      'X-Device-Id': installationId,
      'content-type': 'application/json'
    };
  }

  async function readResponse(
    response: Response
  ) {
    const data = await response
      .json()
      .catch(() => ({
        error:
          'Server returned an invalid response.'
      }));

    if (!response.ok) {
      throw new Error(
        data.error ||
          `CMS request failed (${response.status})`
      );
    }

    return data;
  }

  useEffect(() => {
    if (
      !projectId &&
      projects.length > 0
    ) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects]);

  async function loadRevisions(
    documentId: string
  ) {
    setRevisionLoading(true);

    try {
      const response = await fetch(
        `${apiBase}/cms/documents/${documentId}/revisions` +
          `?email=${encodeURIComponent(email)}`,
        {
          headers: headers()
        }
      );

      const data = await readResponse(response) as {
        revisions: CmsRevision[];
      };

      setRevisions(data.revisions || []);
    } catch (revisionError) {
      setError(
        revisionError instanceof Error
          ? revisionError.message
          : 'Could not load revision history.'
      );
    } finally {
      setRevisionLoading(false);
    }
  }

  async function restoreRevision(
    version: number
  ) {
    if (!selectedDocument) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${apiBase}/cms/documents/${selectedDocument.id}` +
          `/restore/${version}` +
          `?email=${encodeURIComponent(email)}`,
        {
          method: 'POST',
          headers: headers()
        }
      );

      await readResponse(response);

      setMessage(
        `Version ${version} restored successfully.`
      );

      await loadCms(projectId);
      await loadRevisions(selectedDocument.id);
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : 'Could not restore this revision.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function loadCms(
    activeProjectId = projectId
  ) {
    if (!activeProjectId || !email || !token) {
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${apiBase}/cms/projects/${activeProjectId}` +
          `?email=${encodeURIComponent(email)}`,
        {
          headers: headers()
        }
      );

      const data =
        await readResponse(response) as CmsResponse;

      setSettings(data.settings);
      setDocuments(data.documents || []);

      if (
        selectedId &&
        !data.documents.some(
          (document) => document.id === selectedId
        )
      ) {
        setSelectedId(null);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load CMS.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function enableCms() {
    if (!projectId) {
      setError('Select a website first.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${apiBase}/cms/projects/${projectId}/bootstrap` +
          `?email=${encodeURIComponent(email)}`,
        {
          method: 'POST',
          headers: headers()
        }
      );

      await readResponse(response);
      setMessage('CMS enabled successfully.');
      await loadCms(projectId);
    } catch (enableError) {
      setError(
        enableError instanceof Error
          ? enableError.message
          : 'Could not enable CMS.'
      );
    } finally {
      setSaving(false);
    }
  }

  function resetEditor() {
    setSelectedId(null);
    setTitle('');
    setSlug('');
    setStatus('draft');
    setContentText(
      '{\n  "heading": "",\n  "description": ""\n}'
    );
    setSeoTitle('');
    setSeoDescription('');
    setRevisions([]);
    setError('');
    setMessage('');
  }

  function openDocument(
    document: CmsDocument
  ) {
    setSelectedId(document.id);
    setActiveCollection(document.collection);
    setTitle(document.title);
    setSlug(document.slug);
    setStatus(
      document.status === 'published'
        ? 'published'
        : 'draft'
    );
    setContentText(
      JSON.stringify(
        document.content || {},
        null,
        2
      )
    );

    const seo =
      document.seo &&
      typeof document.seo === 'object'
        ? document.seo
        : {};

    setSeoTitle(
      typeof seo.title === 'string'
        ? seo.title
        : ''
    );

    setSeoDescription(
      typeof seo.description === 'string'
        ? seo.description
        : ''
    );

    setError('');
    setMessage('');
    void loadRevisions(document.id);
  }

  function startNewDocument() {
    resetEditor();

    const label = activeCollection
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (letter) =>
        letter.toUpperCase()
      );

    setTitle(`New ${label} Item`);
    setSlug(
      createSlug(
        `new-${activeCollection}-item`
      )
    );
  }

  useEffect(() => {
    if (projectId) {
      resetEditor();
      void loadCms(projectId);
    }
  }, [projectId]);

  useEffect(() => {
    if (
      title &&
      !selectedDocument &&
      (
        !slug ||
        slug.startsWith('new-')
      )
    ) {
      setSlug(createSlug(title));
    }
  }, [title, selectedDocument]);

  async function saveDocument(
    event: FormEvent
  ) {
    event.preventDefault();

    if (!projectId) {
      setError('Select a website first.');
      return;
    }

    if (!title.trim()) {
      setError('Enter a title.');
      return;
    }

    const cleanSlug = createSlug(slug || title);

    if (!cleanSlug) {
      setError('Enter a valid slug.');
      return;
    }

    let parsedContent:
      Record<string, unknown>;

    try {
      const value = JSON.parse(contentText);

      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        throw new Error();
      }

      parsedContent =
        value as Record<string, unknown>;
    } catch {
      setError(
        'Content JSON is invalid. Check brackets, commas and quotes.'
      );
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const payload = {
        collection: activeCollection,
        title: title.trim(),
        slug: cleanSlug,
        status,
        content: parsedContent,
        seo: {
          title:
            seoTitle.trim() || title.trim(),
          description:
            seoDescription.trim()
        },
        sortOrder:
          selectedDocument?.sort_order || 0
      };

      const endpoint = selectedDocument
        ? `${apiBase}/cms/documents/${selectedDocument.id}` +
          `?email=${encodeURIComponent(email)}`
        : `${apiBase}/cms/projects/${projectId}/documents` +
          `?email=${encodeURIComponent(email)}`;

      const response = await fetch(endpoint, {
        method:
          selectedDocument
            ? 'PATCH'
            : 'POST',
        headers: headers(),
        body: JSON.stringify(payload)
      });

      const data = await readResponse(response);

      setSelectedId(data.document.id);
      setSlug(data.document.slug);

      setMessage(
        status === 'published'
          ? 'Content saved and published.'
          : 'Draft saved successfully.'
      );

      await loadCms(projectId);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Could not save CMS content.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(
    nextStatus: 'draft' | 'published'
  ) {
    if (!selectedDocument) {
      setError(
        'Save this item before changing its status.'
      );
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${apiBase}/cms/documents/${selectedDocument.id}/${nextStatus}` +
          `?email=${encodeURIComponent(email)}`,
        {
          method: 'POST',
          headers: headers()
        }
      );

      await readResponse(response);

      setStatus(nextStatus);

      setMessage(
        nextStatus === 'published'
          ? 'Content published successfully.'
          : 'Content moved to drafts.'
      );

      await loadCms(projectId);
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : 'Could not change publishing status.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteDocument() {
    if (!selectedDocument) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${selectedDocument.title}" permanently?`
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${apiBase}/cms/documents/${selectedDocument.id}` +
          `?email=${encodeURIComponent(email)}`,
        {
          method: 'DELETE',
          headers: headers()
        }
      );

      await readResponse(response);

      resetEditor();
      setMessage('CMS item deleted.');
      await loadCms(projectId);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Could not delete CMS item.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="cms-studio">
      <header className="cms-header">
        <div>
          <p className="eyebrow">
            CONTENT MANAGEMENT SYSTEM
          </p>
          <h1>Website CMS</h1>
          <p>
            Pages, products, blogs aur SEO ko
            bina code edit kiye manage karo.
          </p>
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={() => void loadCms()}
          disabled={!projectId || loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      <div className="cms-project-bar">
        <label>
          Website
          <select
            value={projectId}
            onChange={(event) =>
              setProjectId(event.target.value)
            }
          >
            {projects.length === 0 ? (
              <option value="">
                No generated websites
              </option>
            ) : null}

            {projects.map((project) => (
              <option
                key={project.id}
                value={project.id}
              >
                {project.name}
              </option>
            ))}
          </select>
        </label>

        {!settings ? (
          <button
            type="button"
            className="primary-button"
            onClick={() => void enableCms()}
            disabled={!projectId || saving}
          >
            {saving ? 'Enabling…' : 'Enable CMS'}
          </button>
        ) : (
          <div className="cms-live-status">
            <strong>CMS Active</strong>
            <span>
              Version {settings.content_version}
            </span>
            <code>{settings.public_slug}</code>
          </div>
        )}
      </div>

      {error ? (
        <div className="error-banner">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="success-banner">
          {message}
        </div>
      ) : null}

      <div className="cms-collections">
        {collections.map((collection) => (
          <button
            type="button"
            key={collection}
            className={
              activeCollection === collection
                ? 'cms-collection active'
                : 'cms-collection'
            }
            onClick={() => {
              setActiveCollection(collection);
              resetEditor();
            }}
          >
            {collection}
            <span>
              {
                documents.filter(
                  (document) =>
                    document.collection === collection
                ).length
              }
            </span>
          </button>
        ))}
      </div>

      <div className="cms-layout">
        <aside className="cms-sidebar">
          <div className="cms-sidebar-heading">
            <div>
              <strong>{activeCollection}</strong>
              <small>
                {visibleDocuments.length} items
              </small>
            </div>

            <button
              type="button"
              onClick={startNewDocument}
              disabled={!settings}
            >
              + New
            </button>
          </div>

          <div className="cms-document-list">
            {visibleDocuments.length === 0 ? (
              <div className="cms-empty">
                <strong>No content yet</strong>
                <p>
                  New button se content add karo.
                </p>
              </div>
            ) : (
              visibleDocuments.map((document) => (
                <button
                  type="button"
                  key={document.id}
                  className={
                    selectedId === document.id
                      ? 'cms-document active'
                      : 'cms-document'
                  }
                  onClick={() =>
                    openDocument(document)
                  }
                >
                  <span>
                    <strong>
                      {document.title}
                    </strong>
                    <small>
                      /{document.slug}
                    </small>
                  </span>

                  <em
                    className={
                      `cms-status ${document.status}`
                    }
                  >
                    {document.status}
                  </em>
                </button>
              ))
            )}
          </div>
        </aside>

        <form
          className="cms-editor"
          onSubmit={(event) =>
            void saveDocument(event)
          }
        >
          <div className="cms-editor-heading">
            <div>
              <p className="eyebrow">
                {selectedDocument
                  ? 'EDIT CONTENT'
                  : 'CREATE CONTENT'}
              </p>

              <h2>
                {selectedDocument?.title ||
                  `New ${activeCollection} item`}
              </h2>
            </div>

            <span
              className={`cms-status ${status}`}
            >
              {status}
            </span>
          </div>

          {!settings ? (
            <div className="cms-empty cms-enable-message">
              <strong>Enable CMS first</strong>
              <p>
                Website par CMS enable karne ke
                baad editor unlock hoga.
              </p>
            </div>
          ) : (
            <>
              <div className="cms-form-grid">
                <label>
                  Title

                  <input
                    value={title}
                    onChange={(event) =>
                      setTitle(event.target.value)
                    }
                    placeholder="Home Page"
                    required
                  />
                </label>

                <label>
                  URL Slug

                  <input
                    value={slug}
                    onChange={(event) =>
                      setSlug(
                        createSlug(
                          event.target.value
                        )
                      )
                    }
                    placeholder="home-page"
                    required
                  />
                </label>
              </div>

              <label>
                Content Data

                <textarea
                  className="cms-json-editor"
                  value={contentText}
                  onChange={(event) =>
                    setContentText(
                      event.target.value
                    )
                  }
                  rows={13}
                  spellCheck={false}
                />

                <small>
                  Heading, description, price,
                  images aur sections JSON format
                  me manage karo.
                </small>
              </label>

              <div className="cms-seo-card">
                <div>
                  <p className="eyebrow">
                    SEO SETTINGS
                  </p>
                  <h3>Google Search Preview</h3>
                </div>

                <label>
                  SEO Title
                  <input
                    value={seoTitle}
                    onChange={(event) =>
                      setSeoTitle(event.target.value)
                    }
                    placeholder={
                      title || 'Page title'
                    }
                  />
                </label>

                <label>
                  Meta Description
                  <textarea
                    value={seoDescription}
                    onChange={(event) =>
                      setSeoDescription(
                        event.target.value
                      )
                    }
                    rows={3}
                    maxLength={180}
                    placeholder="Google search description"
                  />
                </label>

                <div className="cms-search-preview">
                  <small>
                    {settings.public_slug}/{slug}
                  </small>

                  <strong>
                    {seoTitle ||
                      title ||
                      'Page title'}
                  </strong>

                  <p>
                    {seoDescription ||
                      'Page description will appear here.'}
                  </p>
                </div>
              </div>

              <div className="cms-editor-actions">
                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(
                      event.target.value as
                        | 'draft'
                        | 'published'
                    )
                  }
                >
                  <option value="draft">
                    Save as Draft
                  </option>

                  <option value="published">
                    Save and Publish
                  </option>
                </select>

                {selectedDocument ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      void changeStatus(
                        status === 'published'
                          ? 'draft'
                          : 'published'
                      )
                    }
                    disabled={saving}
                  >
                    {status === 'published'
                      ? 'Move to Draft'
                      : 'Publish Now'}
                  </button>
                ) : null}

                {selectedDocument ? (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() =>
                      void deleteDocument()
                    }
                    disabled={saving}
                  >
                    Delete
                  </button>
                ) : null}

                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving}
                >
                  {saving
                    ? 'Saving…'
                    : selectedDocument
                      ? 'Save Changes'
                      : 'Create Item'}
                </button>
              </div>

              {selectedDocument ? (
                <section className="cms-revisions">
                  <div className="cms-revisions-heading">
                    <div>
                      <p className="eyebrow">
                        REVISION HISTORY
                      </p>
                      <h3>Previous Versions</h3>
                    </div>

                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        void loadRevisions(
                          selectedDocument.id
                        )
                      }
                      disabled={revisionLoading}
                    >
                      {revisionLoading
                        ? 'Loading…'
                        : 'Refresh History'}
                    </button>
                  </div>

                  {revisionLoading ? (
                    <p className="cms-revision-message">
                      Loading revision history…
                    </p>
                  ) : revisions.length === 0 ? (
                    <p className="cms-revision-message">
                      No previous versions available yet.
                    </p>
                  ) : (
                    <div className="cms-revision-list">
                      {revisions.map((revision) => (
                        <article
                          className="cms-revision-item"
                          key={revision.id}
                        >
                          <div>
                            <strong>
                              Version {revision.version_number}
                            </strong>

                            <small>
                              {revision.change_note ||
                                'CMS content update'}
                            </small>

                            <time>
                              {new Date(
                                revision.created_at
                              ).toLocaleString()}
                            </time>
                          </div>

                          <button
                            type="button"
                            className="secondary-button"
                            disabled={saving}
                            onClick={() => {
                              const confirmed =
                                window.confirm(
                                  `Restore version ${revision.version_number}?`
                                );

                              if (confirmed) {
                                void restoreRevision(
                                  revision.version_number
                                );
                              }
                            }}
                          >
                            Restore
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}
            </>
          )}
        </form>
      </div>
    </section>
  );
}
