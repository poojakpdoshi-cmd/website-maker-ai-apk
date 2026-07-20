import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useRef,
  useState
} from 'react';
import ThinkMaxControl from './ThinkMaxControl';

type ChatResult = {
  projectName: string;
} | null;

export type ChatHistoryItem = {
  role: 'assistant' | 'user';
  text: string;
};

export type ChatTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type ChatAssistantReply = {
  text: string;
  processingDurationMs: number | null;
  tokenUsage: ChatTokenUsage | null;
};

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


function isTerminalActivityStatus(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'canceled'].includes(
    status.toLowerCase()
  );
}

function mergeActivity(
  current: LiveBuildActivity | undefined,
  incoming: LiveBuildActivity
): LiveBuildActivity {
  if (!current || current.jobId !== incoming.jobId) return incoming;

  const currentTerminal = isTerminalActivityStatus(current.status);
  const incomingTerminal = isTerminalActivityStatus(incoming.status);

  if (currentTerminal && !incomingTerminal) return current;
  if (incomingTerminal && !currentTerminal) return incoming;

  if ((incoming.progress ?? 0) < (current.progress ?? 0)) return current;
  return incoming;
}

type Props = {
  busy: boolean;
  userKey: string;
  activity?: LiveBuildActivity | null;
  thinkMaxEnabled: boolean;
  onThinkMaxChange: (enabled: boolean) => void;
  onGenerate: (
    prompt: string,
    image?: {
      name: string;
      dataUrl: string;
    } | null,
    activityListener?: (activity: LiveBuildActivity) => void
  ) => Promise<ChatResult>;
  onChat: (prompt: string, history: ChatHistoryItem[], attachment?: { name: string; dataUrl: string } | null) => Promise<ChatAssistantReply>;
  onOpenPreview: () => void;
  onNavigate: (tab: WorkspaceTab) => void;
};

type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  createdAt?: string | null;
  processingDurationMs?: number | null;
  tokenUsage?: ChatTokenUsage | null;
};

type SavedChat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  activity?: LiveBuildActivity | null;
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

function createMessage(
  role: Message['role'],
  text: string,
  metadata: Pick<
    Message,
    'processingDurationMs' | 'tokenUsage'
  > = {}
): Message {
  return {
    id: makeId(),
    role,
    text,
    createdAt: new Date().toISOString(),
    ...metadata
  };
}

function normalizeMessage(value: unknown): Message | null {
  if (!value || typeof value !== 'object') return null;

  const item = value as Partial<Message>;
  if (
    (item.role !== 'assistant' && item.role !== 'user') ||
    typeof item.text !== 'string'
  ) {
    return null;
  }

  const createdAt = typeof item.createdAt === 'string' &&
    Number.isFinite(Date.parse(item.createdAt))
    ? item.createdAt
    : null;
  const processingDurationMs =
    typeof item.processingDurationMs === 'number' &&
    Number.isFinite(item.processingDurationMs) &&
    item.processingDurationMs >= 0
      ? item.processingDurationMs
      : null;
  const rawUsage = item.tokenUsage;
  const normalizeTokenCount = (tokenValue: unknown): number | null =>
    typeof tokenValue === 'number' &&
    Number.isFinite(tokenValue) &&
    tokenValue >= 0
      ? Math.round(tokenValue)
      : null;
  const tokenUsage = rawUsage && typeof rawUsage === 'object'
    ? {
        inputTokens: normalizeTokenCount(rawUsage.inputTokens),
        outputTokens: normalizeTokenCount(rawUsage.outputTokens),
        totalTokens: normalizeTokenCount(rawUsage.totalTokens)
      }
    : null;

  return {
    id: typeof item.id === 'string' && item.id ? item.id : makeId(),
    role: item.role,
    text: item.text,
    createdAt,
    processingDurationMs,
    tokenUsage
  };
}

function normalizeSavedChats(value: unknown): SavedChat[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];

    const chat = item as Partial<SavedChat>;
    if (!Array.isArray(chat.messages)) return [];

    const messages = chat.messages
      .map(normalizeMessage)
      .filter((message): message is Message => Boolean(message));

    return [{
      id: typeof chat.id === 'string' && chat.id ? chat.id : makeId(),
      title: typeof chat.title === 'string' && chat.title
        ? chat.title
        : 'Saved chat',
      updatedAt: typeof chat.updatedAt === 'number'
        ? chat.updatedAt
        : 0,
      messages,
      activity: chat.activity || null
    }];
  });
}

function formatMessageTimestamp(value: string | null | undefined): string {
  if (!value) return 'Time unavailable';

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';

  const time = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
  const calendarDate = date.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  return `${calendarDate}, ${time}`;
}

function formatProcessingDuration(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 'Processing time unavailable';
  }

  if (value < 1000) return `Processed in ${Math.round(value)} ms`;
  if (value < 60000) return `Processed in ${(value / 1000).toFixed(1)} s`;

  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return `Processed in ${minutes}m ${seconds}s`;
}

function formatTokenUsage(usage: ChatTokenUsage | null | undefined): string {
  return typeof usage?.totalTokens === 'number'
    ? `${usage.totalTokens.toLocaleString()} tokens used`
    : 'Token usage unavailable';
}

export default function ChatStudio({
  busy,
  userKey,
  activity,
  thinkMaxEnabled,
  onThinkMaxChange,
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
    'nexora-chat-history:' +
    (userKey || 'anonymous').toLowerCase();

  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [activeChatId, setActiveChatId] = useState(() => makeId());
  const [messages, setMessages] = useState<Message[]>([]);
  const activeChatIdRef = useRef(activeChatId);

  const [chatActivities, setChatActivities] = useState<
    Record<string, LiveBuildActivity>
  >({});

  const activeActivity =
    chatActivities[activeChatId] ||
    (Object.keys(chatActivities).length === 0
      ? activity || null
      : null);

  const buildActive = Boolean(
    activeActivity &&
      !['completed', 'failed', 'cancelled', 'canceled', 'unknown'].includes(
        activeActivity.status.toLowerCase()
      )
  );

  useEffect(() => {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(storageKey) || '[]'
      ) as unknown;
      const chats = normalizeSavedChats(parsed);
      setSavedChats(chats);

      setChatActivities(
        Object.fromEntries(
          chats
            .filter((chat) => Boolean(chat.activity))
            .map((chat) => [chat.id, chat.activity])
        ) as Record<string, LiveBuildActivity>
      );

      const activeJobId = localStorage.getItem(
        'nexora-active-generation-job'
      );
      const activeBuildChat = activeJobId
        ? chats.find((chat) => chat.activity?.jobId === activeJobId)
        : undefined;

      if (activeBuildChat) {
        setActiveChatId(activeBuildChat.id);
        setMessages(activeBuildChat.messages);
      }
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
          messages,
          activity: activeActivity
        },
        ...current.filter((item) => item.id !== activeChatId)
      ].slice(0, 100);

      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }, [activeActivity, activeChatId, messages, storageKey]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    setSavedChats((current) => {
      let changed = false;

      const next = current.map((chat) => {
        const nextActivity = chatActivities[chat.id];

        if (!nextActivity || chat.activity === nextActivity) {
          return chat;
        }

        changed = true;
        return { ...chat, activity: nextActivity };
      });

      if (changed) {
        localStorage.setItem(storageKey, JSON.stringify(next));
      }

      return changed ? next : current;
    });
  }, [chatActivities, storageKey]);

  useEffect(() => {
    if (!activity) return;

    setChatActivities((current) => {
      const matchingChatId = Object.entries(current)
        .find(([, item]) => item.jobId === activity.jobId)?.[0];
      const chatId = matchingChatId || activeChatIdRef.current;

      return {
        ...current,
        [chatId]: mergeActivity(current[chatId], activity)
      };
    });
  }, [activity]);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end'
    });
  }, [messages, buildActive]);

  function newChat(): void {
    const nextChatId = makeId();
    activeChatIdRef.current = nextChatId;
    setActiveChatId(nextChatId);
    setMessages([]);
    setDraft('');
    setImage(null);
    setMenuOpen(false);
    setAttachmentMenuOpen(false);
    setLiveRoomOpen(false);
  }

  function appendMessageToChat(
    chatId: string,
    fallbackMessages: Message[],
    message: Message
  ): void {
    if (activeChatIdRef.current === chatId) {
      setMessages((current) => [...current, message]);
      return;
    }

    setSavedChats((current) => {
      const existing = current.find((chat) => chat.id === chatId);
      const messagesForChat = [
        ...(existing?.messages || fallbackMessages),
        message
      ];
      const title = messagesForChat
        .find((item) => item.role === 'user')
        ?.text.replace(/\s+/g, ' ')
        .slice(0, 52) || 'New chat';
      const next: SavedChat[] = [
        {
          id: chatId,
          title,
          updatedAt: Date.now(),
          messages: messagesForChat,
          activity: chatActivities[chatId] || existing?.activity || null
        },
        ...current.filter((chat) => chat.id !== chatId)
      ].slice(0, 100);

      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }

  function selectAttachment(
    event: ChangeEvent<HTMLInputElement>
  ): void {
    const file = event.target.files?.[0];

    if (!file) return;

    if (file.size > 4 * 1024 * 1024) {
      setMessages((current) => [
        ...current,
        createMessage('assistant', 'Attachments must be smaller than 4 MB.')
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
        createMessage('assistant', 'The selected file could not be read.')
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

    const websiteBuildRequest = isWebsiteBuildRequest(request);

    if (websiteBuildRequest && (busy || buildActive)) {
      setMessages((current) => [
        ...current,
        createMessage(
          'assistant',
          'A website build is already running. You can keep chatting, but wait for it to finish before starting another build.'
        )
      ]);
      return;
    }

    const attachedImage = image;
    const chatHistory = messages;
    const requestChatId = activeChatId;
    const requestStartedAt = Date.now();
    const userMessage = createMessage(
      'user',
      image
        ? `${request}\n\nAttached: ${image.name}`
        : request
    );
    const pendingMessages = [...chatHistory, userMessage];

    setMessages((current) => [
      ...current,
      userMessage
    ]);

    setDraft('');
    setImage(null);

    if (!websiteBuildRequest) {
      try {
        const reply = await onChat(request, chatHistory, attachedImage);
        appendMessageToChat(
          requestChatId,
          pendingMessages,
          createMessage('assistant', reply.text, {
            processingDurationMs: reply.processingDurationMs,
            tokenUsage: reply.tokenUsage
          })
        );
      } catch (chatError) {
        const text = chatError instanceof Error ? chatError.message : 'Assistant request failed.';
        appendMessageToChat(
          requestChatId,
          pendingMessages,
          createMessage('assistant', `Assistant error: ${text}`)
        );
      }
      return;
    }

    try {
      const generated = await onGenerate(
        request,
        attachedImage,
        (nextActivity) => {
          setChatActivities((current) => ({
            ...current,
            [requestChatId]: mergeActivity(
              current[requestChatId],
              nextActivity
            )
          }));
        }
      );

      if (!generated) {
        throw new Error(
          'Website generation failed without an error message.'
        );
      }

      setHasProject(true);
      setChatActivities((current) => {
        const existing = current[requestChatId];
        if (!existing) return current;

        return {
          ...current,
          [requestChatId]: {
            ...existing,
            status: 'completed',
            progress: 100,
            currentAgent: null,
            currentStep: 'preview_ready'
          }
        };
      });

      appendMessageToChat(
        requestChatId,
        pendingMessages,
        createMessage(
          'assistant',
            `${generated.projectName} is ready. ` +
            'The project was generated and validated.',
          {
            processingDurationMs: Date.now() - requestStartedAt,
            tokenUsage: null
          }
        )
      );
    } catch (buildError) {
      const buildMessage =
        buildError instanceof Error
          ? buildError.message
          : 'Website generation failed.';

      appendMessageToChat(
        requestChatId,
        pendingMessages,
        createMessage(
          'assistant',
            `Build failed: ${buildMessage}\n\n` +
            'Check your connection and try again.',
          {
            processingDurationMs: Date.now() - requestStartedAt,
            tokenUsage: null
          }
        )
      );
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
          <div className="claude-brand-icon">
            <img src="/icons/icon-192.png" alt="" />
          </div>

          <div>
            <strong>Nexora.Ai</strong>
            <small>AI website builder</small>
          </div>
        </div>

        <button
          type="button"
          className="claude-mode-pill"
          onClick={() => onThinkMaxChange(!thinkMaxEnabled)}
          aria-pressed={thinkMaxEnabled}
          disabled={busy || buildActive}
        >
          {thinkMaxEnabled ? 'ThinkMax on' : 'ThinkMax off'}
          <span aria-hidden="true">⌄</span>
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
            <div className="claude-brand-icon">
              <img src="/icons/icon-192.png" alt="" />
            </div>

            <div>
              <strong>Nexora.Ai</strong>
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
          <strong>Nexora.Ai</strong>
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
              <div className="claude-welcome-logo">
                <img src="/icons/icon-192.png" alt="" />
              </div>

              <p>Nexora Council</p>

              <h1>
                What would you
                <br />
                <span>like</span>
                <br />
                to build?
              </h1>

              <span className="claude-welcome-copy">
                Describe your idea and Nexora will plan,
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
                      N
                    </div>
                  )}

                  <div className="claude-message-body">
                    {message.role === 'assistant' && (
                      <strong>Nexora</strong>
                    )}

                    <p>{message.text}</p>

                    <div className="claude-message-meta">
                      <span>
                        {message.role === 'user' ? 'Sent' : 'Received'}{' '}
                        <time dateTime={message.createdAt || undefined}>
                          {formatMessageTimestamp(message.createdAt)}
                        </time>
                      </span>
                      {message.role === 'assistant' && (
                        <>
                          <span>
                            {formatProcessingDuration(
                              message.processingDurationMs
                            )}
                          </span>
                          <span>{formatTokenUsage(message.tokenUsage)}</span>
                        </>
                      )}
                    </div>
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
                      {activeActivity?.currentAgent || 'Nexora Council'} is working
                    </strong>

                    <p>
                      {activeActivity?.events.at(-1)?.detail ||
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

          <ThinkMaxControl
            enabled={thinkMaxEnabled}
            onChange={onThinkMaxChange}
            disabled={busy || buildActive}
            description="Deeper planning and review; generation may take longer."
            descriptionId="chat-thinkmax-description"
            chat
          />

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
              placeholder="Message Nexora..."
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
                disabled={
                  draft.trim().length < 1 ||
                  ((busy || buildActive) &&
                    isWebsiteBuildRequest(draft))
                }
                aria-label="Send message"
              >
                {'↑'}
              </button>
            </div>
          </form>

          <small className="claude-disclaimer">
            Nexora may make mistakes. Review before publishing.
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
                  {activeActivity?.currentAgent || 'Nexora Council'} is working
                </strong>
                <span>
                  {activeActivity?.events.at(-1)?.detail ||
                    'Your project is being processed by the agents.'}
                </span>
              </div>
            </div>

            <div className="claude-progress-track">
              <span
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(0, activeActivity?.progress ?? 0)
                  )}%`,
                  animation: activity ? 'none' : undefined
                }}
              />
            </div>

            <p className="claude-live-progress-label">
              {Math.min(
                100,
                Math.max(0, activeActivity?.progress ?? 0)
              )}% complete
            </p>

            <div className="claude-build-timeline">
              {activeActivity?.events.length ? (
                (activeActivity?.events || []).map((event, index) => {
                  const isLast =
                    index === (activeActivity?.events.length || 0) - 1;

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
