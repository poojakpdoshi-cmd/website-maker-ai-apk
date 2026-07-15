import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useRef,
  useState
} from 'react';

type ChatResult = {
  projectName: string;
} | null;

type ChatHistoryItem = { role: 'assistant' | 'user'; text: string };

type WorkspaceTab =
  | 'create'
  | 'preview'
  | 'projects'
  | 'connect'
  | 'account';

export type LiveBuildActivity = {
  jobId: string;
  status: string;
  progress: number;
  currentAgent?: string | null;
  currentStep?: string | null;
  events: Array<{
    id: number;
    agent_name?: string | null;
    status: string;
    title: string;
    detail?: string | null;
    progress?: number | null;
    created_at: string;
  }>;
};

type Props = {
  busy: boolean;
  userKey: string;
  activity?: LiveBuildActivity | null;
  onGenerate: (
    prompt: string,
    image?: {
      name: string;
      dataUrl: string;
    } | null
  ) => Promise<ChatResult>;
  onChat: (prompt: string, history: ChatHistoryItem[]) => Promise<string>;
  onOpenPreview: () => void;
  onNavigate: (tab: WorkspaceTab) => void;
};

type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
};

type SavedChat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
};

const starters = [
  'Build a premium modern business website',
  'Create a complete ecommerce website with cart',
  'Design a cinematic 3D animated website',
  'Build a professional analytics dashboard'
];

function isWebsiteBuildRequest(value: string): boolean {
  const target = /\b(website|web site|landing page|portfolio|e-?commerce|online store|dashboard|web app|frontend|full[- ]stack site)\b/i;
  const action = /\b(build|create|make|design|generate|develop|redesign|code|need|want)\b/i;
  return target.test(value) && action.test(value);
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ChatStudio({
  busy,
  userKey,
  activity,
  onGenerate,
  onChat,
  onOpenPreview,
  onNavigate
}: Props) {
  const imageRef = useRef<HTMLInputElement | null>(null);
  const documentRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] =
    useState(false);
  const [liveRoomOpen, setLiveRoomOpen] = useState(false);
  const [hasProject, setHasProject] = useState(false);

  const [image, setImage] = useState<{
    name: string;
    dataUrl: string;
  } | null>(null);

  const storageKey =
    'webforge-chat-history:' +
    (userKey || 'anonymous').toLowerCase();

  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [activeChatId, setActiveChatId] = useState(() => makeId());
  const [messages, setMessages] = useState<Message[]>([]);

  const buildActive = Boolean(
    activity &&
      !['completed', 'failed', 'cancelled'].includes(
        activity.status.toLowerCase()
      )
  );

  useEffect(() => {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(storageKey) || '[]'
      ) as SavedChat[];
      setSavedChats(Array.isArray(parsed) ? parsed : []);
    } catch {
      setSavedChats([]);
    }
  }, [storageKey]);

  useEffect(() => {
    if (messages.length === 0) return;

    setSavedChats((current) => {
      const title =
        messages.find((item) => item.role === 'user')?.text
          .replace(/\s+/g, ' ')
          .slice(0, 52) || 'New chat';

      const next: SavedChat[] = [
        {
          id: activeChatId,
          title,
          updatedAt: Date.now(),
          messages
        },
        ...current.filter((item) => item.id !== activeChatId)
      ].slice(0, 100);

      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }, [activeChatId, messages, storageKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end'
    });
  }, [messages, buildActive]);

  function newChat(): void {
    setActiveChatId(makeId());
    setMessages([]);
    setDraft('');
    setImage(null);
    setMenuOpen(false);
    setAttachmentMenuOpen(false);
  }

  function selectAttachment(
    event: ChangeEvent<HTMLInputElement>
  ): void {
    const file = event.target.files?.[0];

    if (!file) return;

    if (file.size > 4 * 1024 * 1024) {
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: 'assistant',
          text: 'Attachments must be smaller than 4 MB.'
        }
      ]);

      event.target.value = '';
      setAttachmentMenuOpen(false);
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      setImage({
        name: file.name,
        dataUrl: String(reader.result || '')
      });

      setAttachmentMenuOpen(false);
    };

    reader.onerror = () => {
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: 'assistant',
          text: 'The selected file could not be read.'
        }
      ]);

      setAttachmentMenuOpen(false);
    };

    reader.readAsDataURL(file);
    event.target.value = '';
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();

    const request = draft.trim();

    if (request.length < 1) return;

    const attachedImage = image;
    const chatHistory = messages;

    setMessages((current) => [
      ...current,
      {
        id: makeId(),
        role: 'user',
        text: image
          ? `${request}\n\nAttached: ${image.name}`
          : request
      }
    ]);

    setDraft('');
    setImage(null);

    if (!isWebsiteBuildRequest(request)) {
      try {
        const reply = await onChat(request, chatHistory);
        setMessages((current) => [
          ...current,
          { id: makeId(), role: 'assistant', text: reply }
        ]);
      } catch (chatError) {
        const text = chatError instanceof Error ? chatError.message : 'Assistant request failed.';
        setMessages((current) => [
          ...current,
          { id: makeId(), role: 'assistant', text: `Assistant error: ${text}` }
        ]);
      }
      return;
    }

    if (buildActive) {
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: 'assistant',
          text:
            'A website build is already running. You can keep chatting, but wait for it to finish before starting another build.'
        }
      ]);
      return;
    }

    try {
      const generated = await onGenerate(
        request,
        attachedImage
      );

      if (!generated) {
        throw new Error(
          'Website generation failed without an error message.'
        );
      }

      setHasProject(true);

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: 'assistant',
          text:
            `${generated.projectName} is ready. ` +
            'The project was generated and validated.'
        }
      ]);
    } catch (buildError) {
      const buildMessage =
        buildError instanceof Error
          ? buildError.message
          : 'Website generation failed.';

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: 'assistant',
          text:
            `Build failed: ${buildMessage}\n\n` +
            'Check your connection and try again.'
        }
      ]);
    }
  }

  return (
    <section className="chat-studio claude-workspace">
      <header className="claude-topbar">
        <button
          type="button"
          className="claude-menu-button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
        >
          <span />
          <span />
        </button>

        <div className="claude-brand">
          <div className="claude-brand-icon">W</div>

          <div>
            <strong>WebForge</strong>
            <small>AI website builder</small>
          </div>
        </div>

        <button
          type="button"
          className="claude-mode-pill"
        >
          Council mode
          <span>⌄</span>
        </button>
      </header>

      <div
        className={
          menuOpen
            ? 'claude-drawer-backdrop open'
            : 'claude-drawer-backdrop'
        }
        onClick={() => setMenuOpen(false)}
      />

      <aside
        className={
          menuOpen
            ? 'claude-drawer open'
            : 'claude-drawer'
        }
      >
        <div className="claude-drawer-header">
          <div className="claude-brand">
            <div className="claude-brand-icon">W</div>

            <div>
              <strong>WebForge.Ai</strong>
              <small>Workspace</small>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            ×
          </button>
        </div>

        <button
          type="button"
          className="claude-new-chat"
          onClick={newChat}
        >
          <span>＋</span>
          New chat
        </button>

        <div className="claude-saved-chats">
          <strong>Recent chats</strong>
          {savedChats.length === 0 ? (
            <small>No saved chats yet</small>
          ) : (
            savedChats.map((chat) => (
              <div key={chat.id} className="claude-saved-chat-row">
                <button
                  type="button"
                  onClick={() => {
                    setActiveChatId(chat.id);
                    setMessages(chat.messages);
                    setMenuOpen(false);
                  }}
                >
                  {chat.title}
                </button>
                <button
                  type="button"
                  aria-label="Delete chat"
                  onClick={() => {
                    setSavedChats((current) => {
                      const next = current.filter(
                        (item) => item.id !== chat.id
                      );
                      localStorage.setItem(
                        storageKey,
                        JSON.stringify(next)
                      );
                      return next;
                    });
                    if (activeChatId === chat.id) newChat();
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        <nav className="claude-drawer-nav">
          <button type="button" onClick={newChat}>
            <span>◌</span>
            Chat
          </button>

          <button
            type="button"
            onClick={() => onNavigate('projects')}
          >
            <span>◇</span>
            My websites
          </button>

          <button
            type="button"
            onClick={() => onNavigate('preview')}
          >
            <span>▣</span>
            Latest preview
          </button>

          <button
            type="button"
            onClick={() => onNavigate('create')}
          >
            <span>＋</span>
            Advanced create
          </button>

          <button
            type="button"
            onClick={() => onNavigate('connect')}
          >
            <span>↗</span>
            Connections
          </button>

          <button
            type="button"
            onClick={() => onNavigate('account')}
          >
            <span>○</span>
            Account
          </button>
        </nav>

        <div className="claude-drawer-footer">
          <strong>WebForge.Ai</strong>
          <span>Made by Poojak Doshi</span>
        </div>
      </aside>

      <main className="claude-chat-main">
        <div
          className={
            messages.length === 0 && !buildActive
              ? 'claude-chat-scroll empty-chat'
              : 'claude-chat-scroll'
          }
          aria-live="polite"
        >
          {messages.length === 0 && !buildActive ? (
            <section className="claude-welcome">
              <div className="claude-welcome-logo">W</div>

              <p>WebForge Council</p>

              <h1>
                What would you like
                <br />
                to build?
              </h1>

              <span className="claude-welcome-copy">
                Describe your idea and WebForge will plan,
                design, code, review and validate it.
              </span>

              <div className="claude-starters">
                {starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => setDraft(starter)}
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="claude-message-list">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`claude-message ${message.role}`}
                >
                  {message.role === 'assistant' && (
                    <div className="claude-assistant-avatar">
                      W
                    </div>
                  )}

                  <div className="claude-message-body">
                    {message.role === 'assistant' && (
                      <strong>WebForge</strong>
                    )}

                    <p>{message.text}</p>
                  </div>
                </article>
              ))}

              {buildActive && (
                <button
                  type="button"
                  className="claude-agent-working"
                  onClick={() => setLiveRoomOpen(true)}
                >
                  <div className="claude-working-orb">
                    <span />
                  </div>

                  <div>
                    <strong>
                      {activity?.currentAgent || 'WebForge Council'} is working
                    </strong>

                    <p>
                      {activity?.events.at(-1)?.detail ||
                        'Planning, coding and validating your project'}
                    </p>

                    <small>
                      Tap to open Live Build Room
                    </small>
                  </div>

                  <span className="claude-working-arrow">
                    ›
                  </span>
                </button>
              )}

              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="claude-composer-area">
          {hasProject && (
            <button
              type="button"
              className="claude-preview-chip"
              onClick={onOpenPreview}
            >
              Open latest preview
              <span>↗</span>
            </button>
          )}

          <form
            className="claude-composer"
            onSubmit={submit}
          >
            {image && (
              <div className="claude-image-preview">
                {image.dataUrl.startsWith('data:image/') ? (
                  <img src={image.dataUrl} alt="" />
                ) : (
                  <div className="claude-file-icon">
                    FILE
                  </div>
                )}
                <span>{image.name}</span>

                <button
                  type="button"
                  onClick={() => setImage(null)}
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
            )}

            <textarea
              value={draft}
              onChange={(event) =>
                setDraft(event.target.value)
              }
              rows={1}
              maxLength={6000}
              placeholder="Message WebForge..."
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  draft.trim().length >= 1
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />

            <div className="claude-composer-footer">
              <div className="claude-composer-tools">
                <div className="claude-attachment-wrap">
                  <button
                    type="button"
                    className="claude-add-button"
                    onClick={() =>
                      setAttachmentMenuOpen(
                        (current) => !current
                      )
                    }
                    aria-label="Attach photo or file"
                  >
                    ＋
                  </button>

                  {attachmentMenuOpen && (
                    <div className="claude-attachment-menu">
                      <button
                        type="button"
                        onClick={() => {
                          setAttachmentMenuOpen(false);
                          imageRef.current?.click();
                        }}
                      >
                        <span>▧</span>
                        <div>
                          <strong>Photo</strong>
                          <small>JPG, PNG, WebP</small>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setAttachmentMenuOpen(false);
                          documentRef.current?.click();
                        }}
                      >
                        <span>▤</span>
                        <div>
                          <strong>File</strong>
                          <small>PDF, docs, text or code</small>
                        </div>
                      </button>
                    </div>
                  )}
                </div>

                <input
                  ref={imageRef}
                  className="chat-file-input"
                  type="file"
                  accept="image/*"
                  onChange={selectAttachment}
                />

                <input
                  ref={documentRef}
                  className="chat-file-input"
                  type="file"
                  accept=".pdf,.txt,.md,.csv,.json,.html,.css,.js,.jsx,.ts,.tsx,.xml,.yaml,.yml,.doc,.docx,application/pdf,text/*"
                  onChange={selectAttachment}
                />

                <span className="claude-tool-label">
                  {image ? image.name : 'Attach'}
                </span>
              </div>

              <button
                type="submit"
                className="claude-send-button"
                disabled={draft.trim().length < 1}
                aria-label="Send message"
              >
                {'↑'}
              </button>
            </div>
          </form>

          <small className="claude-disclaimer">
            WebForge may make mistakes. Review before publishing.
          </small>
        </div>
      </main>

      {liveRoomOpen && (
        <div
          className="claude-live-room-backdrop"
          role="dialog"
          aria-modal="true"
        >
          <section className="claude-live-room">
            <header>
              <div>
                <p>LIVE BUILD ROOM</p>
                <h2>Project activity</h2>
              </div>

              <button
                type="button"
                onClick={() => setLiveRoomOpen(false)}
                aria-label="Close build room"
              >
                ×
              </button>
            </header>

            <div className="claude-live-status">
              <div className="claude-live-pulse" />

              <div>
                <strong>
                  {activity?.currentAgent || 'WebForge Council'} is working
                </strong>
                <span>
                  {activity?.events.at(-1)?.detail ||
                    'Your project is being processed by the agents.'}
                </span>
              </div>
            </div>

            <div className="claude-progress-track">
              <span
                style={{
                  width: `${Math.max(2, activity?.progress || 2)}%`,
                  animation: activity ? 'none' : undefined
                }}
              />
            </div>

            <p className="claude-live-progress-label">
              {activity?.progress || 2}% complete
            </p>

            <div className="claude-build-timeline">
              {activity?.events.length ? (
                activity.events.map((event, index) => {
                  const isLast =
                    index === activity.events.length - 1;

                  const complete =
                    event.status === 'completed' ||
                    !isLast;

                  return (
                    <article
                      key={event.id}
                      className={
                        complete
                          ? 'complete'
                          : isLast
                            ? 'active'
                            : ''
                      }
                    >
                      <span>
                        {complete ? '✓' : isLast ? '●' : '○'}
                      </span>

                      <div>
                        <strong>{event.title}</strong>
                        <small>
                          {event.agent_name
                            ? `${event.agent_name} • `
                            : ''}
                          {event.detail || 'Working on the project.'}
                        </small>
                      </div>
                    </article>
                  );
                })
              ) : (
                <>
                  <article className="complete">
                    <span>✓</span>
                    <div>
                      <strong>Request received</strong>
                      <small>Your instructions were sent securely.</small>
                    </div>
                  </article>

                  <article className="active">
                    <span>●</span>
                    <div>
                      <strong>Starting agents</strong>
                      <small>Waiting for live backend activity.</small>
                    </div>
                  </article>
                </>
              )}
            </div>

            <button
              type="button"
              className="claude-room-close"
              onClick={() => setLiveRoomOpen(false)}
            >
              Return to chat
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
