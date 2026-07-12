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


type CmsMedia = {
  id: string;
  file_name: string;
  storage_path: string;
  public_url?: string | null;
  mime_type: string;
  size_bytes: number;
  alt_text: string;
  created_at: string;
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

  const [cmsSearch, setCmsSearch] =
    useState('');

  const [revisions, setRevisions] =
    useState<CmsRevision[]>([]);

  const [revisionLoading, setRevisionLoading] =
    useState(false);


  const [media, setMedia] =
    useState<CmsMedia[]>([]);

  const [mediaLoading, setMediaLoading] =
    useState(false);

  const [mediaUploading, setMediaUploading] =
    useState(false);

  const [showMediaLibrary, setShowMediaLibrary] =
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

  const [showAdvancedJson, setShowAdvancedJson] =
    useState(false);

  const visualContent = useMemo<
    Record<string, unknown>
  >(() => {
    try {
      const parsed = JSON.parse(contentText);

      return parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }, [contentText]);

  function contentValue(key: string): string {
    const value = visualContent[key];

    return typeof value === 'string' ||
      typeof value === 'number'
      ? String(value)
      : '';
  }

  function updateContentField(
    key: string,
    value: string
  ) {
    setContentText(
      JSON.stringify(
        {
          ...visualContent,
          [key]: value
        },
        null,
        2
      )
    );
  }

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

  const visibleDocuments = useMemo(() => {
    const query = cmsSearch
      .trim()
      .toLowerCase();

    return documents.filter((document) => {
      if (document.collection !== activeCollection) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        document.title.toLowerCase().includes(query) ||
        document.slug.toLowerCase().includes(query) ||
        document.status.toLowerCase().includes(query)
      );
    });
  }, [documents, activeCollection, cmsSearch]);

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

  async function loadMedia(
    activeProjectId = projectId
  ) {
    if (!activeProjectId) {
      return;
    }

    setMediaLoading(true);

    try {
      const response = await fetch(
        `${apiBase}/cms/projects/${activeProjectId}/media` +
          `?email=${encodeURIComponent(email)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Device-Id': installationId
          }
        }
      );

      const data = await readResponse(response) as {
        media: CmsMedia[];
      };

      setMedia(data.media || []);
    } catch (mediaError) {
      setError(
        mediaError instanceof Error
          ? mediaError.message
          : 'Could not load Media Library.'
      );
    } finally {
      setMediaLoading(false);
    }
  }

  async function uploadMedia(
    file: File
  ) {
    if (!projectId) {
      setError('Select a website first.');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Choose a valid image file.');
      return;
    }

    setMediaUploading(true);
    setError('');
    setMessage('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('altText', file.name);

      const response = await fetch(
        `${apiBase}/cms/projects/${projectId}/media` +
          `?email=${encodeURIComponent(email)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Device-Id': installationId
          },
          body: formData
        }
      );

      const data = await readResponse(response) as {
        media: CmsMedia;
      };

      setMedia((current) => [
        data.media,
        ...current.filter(
          (item) => item.id !== data.media.id
        )
      ]);

      if (data.media.public_url) {
        updateContentField(
          'imageUrl',
          data.media.public_url
        );
      }

      setMessage(
        'Image uploaded and selected successfully.'
      );
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'Could not upload image.'
      );
    } finally {
      setMediaUploading(false);
    }
  }

  function selectMedia(
    item: CmsMedia
  ) {
    if (!item.public_url) {
      setError('This image has no public URL.');
      return;
    }

    updateContentField(
      'imageUrl',
      item.public_url
    );

    if (item.alt_text) {
      updateContentField(
        'imageAlt',
        item.alt_text
      );
    }

    setShowMediaLibrary(false);
    setMessage('Image selected from Media Library.');
  }

  async function updateMediaAltText(
    item: CmsMedia
  ) {
    const nextAltText = window.prompt(
      'Enter image alt text:',
      item.alt_text || item.file_name
    );

    if (nextAltText === null || !projectId) {
      return;
    }

    setMediaLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${apiBase}/cms/media/${item.id}` +
          `?projectId=${encodeURIComponent(projectId)}` +
          `&email=${encodeURIComponent(email)}`,
        {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify({
            altText: nextAltText.trim()
          })
        }
      );

      const data = await readResponse(response) as {
        media: CmsMedia;
      };

      setMedia((current) =>
        current.map((mediaItem) =>
          mediaItem.id === item.id
            ? data.media
            : mediaItem
        )
      );

      if (
        item.public_url &&
        contentValue('imageUrl') === item.public_url
      ) {
        updateContentField(
          'imageAlt',
          data.media.alt_text
        );
      }

      setMessage('Image alt text updated.');
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Could not update image alt text.'
      );
    } finally {
      setMediaLoading(false);
    }
  }

  async function deleteMedia(
    item: CmsMedia
  ) {
    if (!projectId) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${item.file_name}" permanently?`
    );

    if (!confirmed) {
      return;
    }

    setMediaLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${apiBase}/cms/media/${item.id}` +
          `?projectId=${encodeURIComponent(projectId)}` +
          `&email=${encodeURIComponent(email)}`,
        {
          method: 'DELETE',
          headers: headers()
        }
      );

      await readResponse(response);

      setMedia((current) =>
        current.filter(
          (mediaItem) => mediaItem.id !== item.id
        )
      );

      if (
        item.public_url &&
        contentValue('imageUrl') === item.public_url
      ) {
        updateContentField('imageUrl', '');
        updateContentField('imageAlt', '');
      }

      setMessage('Image deleted from Media Library.');
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Could not delete image.'
      );
    } finally {
      setMediaLoading(false);
    }
  }

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

          <div className="cms-search-box">
            <input
              type="search"
              value={cmsSearch}
              onChange={(event) =>
                setCmsSearch(event.target.value)
              }
              placeholder={`Search ${activeCollection}…`}
            />

            {cmsSearch ? (
              <button
                type="button"
                onClick={() => setCmsSearch('')}
              >
                Clear
              </button>
            ) : null}
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

              <section className="cms-visual-fields">
                <div className="cms-visual-heading">
                  <div>
                    <p className="eyebrow">
                      CONTENT FIELDS
                    </p>
                    <h3>No-Code Editor</h3>
                  </div>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setShowAdvancedJson(
                        !showAdvancedJson
                      )
                    }
                  >
                    {showAdvancedJson
                      ? 'Hide Advanced JSON'
                      : 'Advanced JSON'}
                  </button>
                </div>

                <div className="cms-form-grid">
                  <label>
                    {activeCollection === 'pages'
                      ? 'Main Heading'
                      : activeCollection === 'faqs'
                        ? 'Question'
                        : 'Name / Heading'}

                    <input
                      value={contentValue(
                        activeCollection === 'pages'
                          ? 'heading'
                          : activeCollection === 'faqs'
                            ? 'question'
                            : 'name'
                      )}
                      onChange={(event) =>
                        updateContentField(
                          activeCollection === 'pages'
                            ? 'heading'
                            : activeCollection === 'faqs'
                              ? 'question'
                              : 'name',
                          event.target.value
                        )
                      }
                      placeholder="Enter heading"
                    />
                  </label>

                  <div className="cms-image-field">
                    <label>
                      Image URL

                      <input
                        value={contentValue('imageUrl')}
                        onChange={(event) =>
                          updateContentField(
                            'imageUrl',
                            event.target.value
                          )
                        }
                        placeholder="https://example.com/image.jpg"
                      />
                    </label>

                    <div className="cms-media-picker-actions">
                      <label className="secondary-button cms-upload-button">
                        {mediaUploading
                          ? 'Uploading…'
                          : 'Upload Image'}

                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          disabled={mediaUploading}
                          onChange={(event) => {
                            const file =
                              event.target.files?.[0];

                            if (file) {
                              void uploadMedia(file);
                            }

                            event.target.value = '';
                          }}
                        />
                      </label>

                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setShowMediaLibrary(true);
                          void loadMedia(projectId);
                        }}
                        disabled={!projectId}
                      >
                        Browse Library
                      </button>
                    </div>

                    {contentValue('imageUrl') ? (
                      <img
                        className="cms-selected-image"
                        src={contentValue('imageUrl')}
                        alt={
                          contentValue('imageAlt') ||
                          'Selected CMS image'
                        }
                      />
                    ) : null}
                  </div>
                </div>

                <label>
                  {activeCollection === 'faqs'
                    ? 'Answer'
                    : 'Description'}

                  <textarea
                    value={contentValue('description')}
                    onChange={(event) =>
                      updateContentField(
                        'description',
                        event.target.value
                      )
                    }
                    rows={5}
                    placeholder="Enter content description"
                  />
                </label>

                {activeCollection === 'products' ||
                activeCollection === 'services' ? (
                  <div className="cms-form-grid">
                    <label>
                      Price

                      <input
                        value={contentValue('price')}
                        onChange={(event) =>
                          updateContentField(
                            'price',
                            event.target.value
                          )
                        }
                        placeholder="₹999"
                      />
                    </label>

                    <label>
                      Button Text

                      <input
                        value={contentValue('buttonText')}
                        onChange={(event) =>
                          updateContentField(
                            'buttonText',
                            event.target.value
                          )
                        }
                        placeholder="Buy Now"
                      />
                    </label>
                  </div>
                ) : null}

                {activeCollection === 'pages' ||
                activeCollection === 'services' ? (
                  <div className="cms-form-grid">
                    <label>
                      Button Text

                      <input
                        value={contentValue('buttonText')}
                        onChange={(event) =>
                          updateContentField(
                            'buttonText',
                            event.target.value
                          )
                        }
                        placeholder="Contact Us"
                      />
                    </label>

                    <label>
                      Button Link

                      <input
                        value={contentValue('buttonUrl')}
                        onChange={(event) =>
                          updateContentField(
                            'buttonUrl',
                            event.target.value
                          )
                        }
                        placeholder="/contact"
                      />
                    </label>
                  </div>
                ) : null}

                {showAdvancedJson ? (
                  <label>
                    Advanced JSON

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
                      Developers ke liye complete JSON control.
                    </small>
                  </label>
                ) : null}
              </section>

              {showMediaLibrary ? (
                <section className="cms-media-library-modal">
                  <div className="cms-media-library-heading">
                    <div>
                      <p className="eyebrow">
                        MEDIA LIBRARY
                      </p>
                      <h3>Select an Image</h3>
                    </div>

                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        setShowMediaLibrary(false)
                      }
                    >
                      Close
                    </button>
                  </div>

                  {mediaLoading ? (
                    <p className="cms-media-message">
                      Loading images…
                    </p>
                  ) : media.length === 0 ? (
                    <p className="cms-media-message">
                      No uploaded images yet.
                    </p>
                  ) : (
                    <div className="cms-media-grid">
                      {media.map((item) => (
                        <article
                          className="cms-media-item"
                          key={item.id}
                        >
                          <button
                            type="button"
                            className="cms-media-select"
                            onClick={() =>
                              selectMedia(item)
                            }
                          >
                            {item.public_url ? (
                              <img
                                src={item.public_url}
                                alt={
                                  item.alt_text ||
                                  item.file_name
                                }
                                loading="lazy"
                              />
                            ) : null}

                            <span>
                              <strong>
                                {item.file_name}
                              </strong>

                              <small>
                                {Math.max(
                                  1,
                                  Math.round(
                                    item.size_bytes / 1024
                                  )
                                )} KB
                              </small>
                            </span>
                          </button>

                          <div className="cms-media-item-actions">
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                void updateMediaAltText(item)
                              }
                              disabled={mediaLoading}
                            >
                              Edit Alt
                            </button>

                            <button
                              type="button"
                              className="danger-button"
                              onClick={() =>
                                void deleteMedia(item)
                              }
                              disabled={mediaLoading}
                            >
                              Delete
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

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
