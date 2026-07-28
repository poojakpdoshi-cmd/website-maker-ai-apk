import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useRef,
  useState
} from 'react';
import ThinkMaxControl from './ThinkMaxControl';
import {
  deleteCachedChat,
  loadCachedChats,
  saveCachedChat
} from './chat-cache';
import { formatElapsedDuration } from './duration-format';

type ChatResult = {
  projectName: string;
  jobId?: string;
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
  provider?: string | null;
  model?: string | null;
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
  errorMessage?: string | null;
  failedStage?: string | null;
  retryable?: boolean;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
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
  apiBase: string;
  token: string;
  installationId: string;
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
  onChat: (
    prompt: string,
    history: ChatHistoryItem[],
    attachment: { name: string; dataUrl: string } | null | undefined,
    identity: {
      conversationId: string;
      userMessageId: string;
      assistantMessageId: string;
      idempotencyKey: string;
    }
  ) => Promise<ChatAssistantReply>;
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
  status?: 'pending' | 'completed' | 'failed' | 'cancelled';
  provider?: string | null;
  model?: string | null;
  operation?: 'qa' | 'generation';
};

type SavedChat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  activity?: LiveBuildActivity | null;
};

type RemoteMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  status: Message['status'];
  provider?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  duration_ms?: number | null;
  created_at: string;
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
  return crypto.randomUUID();
}

function stableId(value: unknown): string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : makeId();
}

function createMessage(
  role: Message['role'],
  text: string,
  metadata: Pick<
    Message,
    'processingDurationMs' | 'tokenUsage' | 'operation'
  > = {}
): Message {
  return {
    id: makeId(),
    role,
    text,
    createdAt: new Date().toISOString(),
    status: 'completed',
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
    id: stableId(item.id),
    role: item.role,
    text: item.text,
    createdAt,
    processingDurationMs,
    tokenUsage,
    status:
      item.status === 'pending' ||
      item.status === 'failed' ||
      item.status === 'cancelled'
        ? item.status
        : 'completed',
    provider: typeof item.provider === 'string' ? item.provider : null,
    model: typeof item.model === 'string' ? item.model : null,
    operation: item.operation === 'generation' ? 'generation' : 'qa'
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
      id: stableId(chat.id),
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

function remoteMessage(value: RemoteMessage): Message {
  return {
    id: value.id,
    role: value.role,
    text: value.content,
    status: value.status,
    provider: value.provider || null,
    model: value.model || null,
    processingDurationMs: value.duration_ms ?? null,
    tokenUsage: {
      inputTokens: value.input_tokens ?? null,
      outputTokens: value.output_tokens ?? null,
      totalTokens: value.total_tokens ?? null
    },
    createdAt: value.created_at
  };
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

function formatProcessingDuration(
  value: number | null | undefined,
  operation: Message['operation']
): string {
  const formatted = formatElapsedDuration(value);
  return formatted
    ? `${operation === 'generation' ? 'Generated' : 'Answered'} in ${formatted}`
    : '';
}

function formatTokenUsage(usage: ChatTokenUsage | null | undefined): string {
  return typeof usage?.totalTokens === 'number'
    ? `${usage.totalTokens.toLocaleString()} tokens used`
    : 'Token usage unavailable';
}

export default function ChatStudio({
  busy,
  userKey,
  apiBase,
  token,
  installationId,
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

  const legacyStorageKey =
    'nexora-chat-history:' +
    (userKey || 'anonymous').toLowerCase();
  const cacheOwner = (userKey || 'guest').toLowerCase();

  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [historySyncState, setHistorySyncState] = useState<
    'loading' | 'synced' | 'offline' | 'failed'
  >('loading');
  const [historyActionError, setHistoryActionError] = useState('');
  const [nextConversationCursor, setNextConversationCursor] =
    useState<string | null>(null);
  const [messageCursors, setMessageCursors] = useState<
    Record<string, string | null>
  >({});
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
    let cancelled = false;

    async function restoreHistory(): Promise<void> {
      setHistorySyncState('loading');
      let cached: SavedChat[] = [];
      try {
        cached = normalizeSavedChats(
          await loadCachedChats<Message, LiveBuildActivity>(cacheOwner)
        );
        const legacyRaw = localStorage.getItem(legacyStorageKey);
        if (legacyRaw) {
          const legacy = normalizeSavedChats(JSON.parse(legacyRaw));
          const merged = [
            ...cached,
            ...legacy.filter(
              (chat) => !cached.some((item) => item.id === chat.id)
            )
          ];
          cached = merged;
          await Promise.all(
            legacy.map((chat) => saveCachedChat(cacheOwner, chat))
          );
          localStorage.removeItem(legacyStorageKey);
        }
      } catch {
        cached = [];
      }

      if (cancelled) return;
      setSavedChats(cached);
      setChatActivities(
        Object.fromEntries(
          cached
            .filter((chat) => Boolean(chat.activity))
            .map((chat) => [chat.id, chat.activity])
        ) as Record<string, LiveBuildActivity>
      );

      if (!token || !navigator.onLine) {
        setHistorySyncState('offline');
        return;
      }

      try {
        const listResponse = await fetch(
          `${apiBase}/conversations?limit=50`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!listResponse.ok) throw new Error('History sync failed.');
        const listData = await listResponse.json() as {
          conversations?: Array<{
            id: string;
            title: string;
            updated_at: string;
            last_message_at: string;
          }>;
          nextCursor?: string | null;
        };
        const remoteCursors: Record<string, string | null> = {};
        const remoteChats = await Promise.all(
          (listData.conversations || []).map(async (conversation) => {
            const response = await fetch(
              `${apiBase}/conversations/${encodeURIComponent(conversation.id)}/messages?limit=50`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!response.ok) throw new Error('Message sync failed.');
            const data = await response.json() as {
              messages?: RemoteMessage[];
              nextCursor?: string | null;
            };
            remoteCursors[conversation.id] = data.nextCursor || null;
            const cachedChat = cached.find(
              (item) => item.id === conversation.id
            );
            return {
              id: conversation.id,
              title: conversation.title,
              updatedAt:
                Date.parse(
                  conversation.last_message_at || conversation.updated_at
                ) || Date.now(),
              messages: (data.messages || []).map(remoteMessage),
              activity: cachedChat?.activity || null
            } satisfies SavedChat;
          })
        );
        const merged = [
          ...remoteChats,
          ...cached.filter(
            (chat) => !remoteChats.some((remote) => remote.id === chat.id)
          )
        ].sort((left, right) => right.updatedAt - left.updatedAt);
        if (cancelled) return;
        setSavedChats(merged);
        setNextConversationCursor(listData.nextCursor || null);
        setMessageCursors((current) => ({
          ...current,
          ...remoteCursors
        }));
        await Promise.all(
          remoteChats.map((chat) => saveCachedChat(cacheOwner, chat))
        );
        setHistorySyncState('synced');
      } catch {
        if (!cancelled) {
          setHistorySyncState(navigator.onLine ? 'failed' : 'offline');
        }
      }
    }

    void restoreHistory();
    return () => {
      cancelled = true;
    };
  }, [apiBase, cacheOwner, legacyStorageKey, token]);

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

      void saveCachedChat(cacheOwner, next[0]);
      return next;
    });
  }, [activeActivity, activeChatId, cacheOwner, messages]);

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
        next.forEach((chat) => void saveCachedChat(cacheOwner, chat));
      }

      return changed ? next : current;
    });
  }, [cacheOwner, chatActivities]);

  useEffect(() => {
    if (!activity) return;

    setChatActivities((current) => {
      const matchingChatId = Object.entries(current)
        .find(([, item]) => item.jobId === activity.jobId)?.[0];
      const chatId = matchingChatId || activeChatIdRef.current;

      return {
        ...current,
        [chatId]: activity
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

  async function openSavedChat(chat: SavedChat): Promise<void> {
    activeChatIdRef.current = chat.id;
    setActiveChatId(chat.id);
    setMessages(chat.messages);
    setMenuOpen(false);
    if (chat.messages.length > 0 || !token || !navigator.onLine) return;

    try {
      const response = await fetch(
        `${apiBase}/conversations/${encodeURIComponent(chat.id)}/messages?limit=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json() as {
        messages?: RemoteMessage[];
        nextCursor?: string | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'Could not load messages.');
      }
      const loaded = (data.messages || []).map(remoteMessage);
      const updated = { ...chat, messages: loaded };
      setMessages(loaded);
      setSavedChats((current) =>
        current.map((item) => item.id === chat.id ? updated : item)
      );
      setMessageCursors((current) => ({
        ...current,
        [chat.id]: data.nextCursor || null
      }));
      await saveCachedChat(cacheOwner, updated);
      setHistoryActionError('');
    } catch (error) {
      setHistoryActionError(
        error instanceof Error ? error.message : 'Could not load messages.'
      );
    }
  }

  async function loadOlderConversations(): Promise<void> {
    if (!nextConversationCursor || !token || !navigator.onLine) return;
    try {
      const response = await fetch(
        `${apiBase}/conversations?limit=50&cursor=${encodeURIComponent(nextConversationCursor)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json() as {
        conversations?: Array<{
          id: string;
          title: string;
          updated_at: string;
          last_message_at: string;
        }>;
        nextCursor?: string | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'Could not load older chats.');
      }
      const older: SavedChat[] = (data.conversations || []).map(
        (conversation) => ({
          id: conversation.id,
          title: conversation.title,
          updatedAt:
            Date.parse(
              conversation.last_message_at || conversation.updated_at
            ) || Date.now(),
          messages: [],
          activity: null
        })
      );
      setSavedChats((current) => [
        ...current,
        ...older.filter(
          (chat) => !current.some((item) => item.id === chat.id)
        )
      ]);
      setNextConversationCursor(data.nextCursor || null);
      setHistoryActionError('');
    } catch (error) {
      setHistoryActionError(
        error instanceof Error ? error.message : 'Could not load older chats.'
      );
    }
  }

  async function loadEarlierMessages(): Promise<void> {
    const cursor = messageCursors[activeChatId];
    if (!cursor || !token || !navigator.onLine) return;
    try {
      const response = await fetch(
        `${apiBase}/conversations/${encodeURIComponent(activeChatId)}/messages?limit=50&cursor=${encodeURIComponent(cursor)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json() as {
        messages?: RemoteMessage[];
        nextCursor?: string | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'Could not load earlier messages.');
      }
      const earlier = (data.messages || []).map(remoteMessage);
      setMessages((current) => [
        ...earlier.filter(
          (message) => !current.some((item) => item.id === message.id)
        ),
        ...current
      ]);
      setMessageCursors((current) => ({
        ...current,
        [activeChatId]: data.nextCursor || null
      }));
      setHistoryActionError('');
    } catch (error) {
      setHistoryActionError(
        error instanceof Error
          ? error.message
          : 'Could not load earlier messages.'
      );
    }
  }

  async function renameChat(chat: SavedChat): Promise<void> {
    const title = window.prompt('Rename this chat', chat.title)?.trim();
    if (!title || title === chat.title) return;
    if (title.length > 120) {
      setHistoryActionError('Chat titles must be 120 characters or fewer.');
      return;
    }
    try {
      if (!token || !navigator.onLine) {
        throw new Error('Connect to the internet to rename this saved chat.');
      }
      const response = await fetch(
        `${apiBase}/conversations/${encodeURIComponent(chat.id)}`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ title })
        }
      );
      const data = await response.json().catch(() => ({})) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'Could not rename the chat.');
      }
      const updated = { ...chat, title, updatedAt: Date.now() };
      setSavedChats((current) =>
        current.map((item) => item.id === chat.id ? updated : item)
      );
      await saveCachedChat(cacheOwner, updated);
      setHistoryActionError('');
    } catch (error) {
      setHistoryActionError(
        error instanceof Error ? error.message : 'Could not rename the chat.'
      );
    }
  }

  async function removeChat(chat: SavedChat): Promise<void> {
    if (!window.confirm(
      `Delete “${chat.title}”? It will be hidden from every signed-in device.`
    )) {
      return;
    }
    try {
      if (token && navigator.onLine) {
        const response = await fetch(
          `${apiBase}/conversations/${encodeURIComponent(chat.id)}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          }
        );
        if (!response.ok && response.status !== 404) {
          const data = await response.json().catch(() => ({})) as {
            error?: string;
          };
          throw new Error(data.error || 'Could not delete the chat.');
        }
      } else if (userKey && userKey !== 'guest') {
        throw new Error('Connect to the internet to delete this saved chat.');
      }
      setSavedChats((current) =>
        current.filter((item) => item.id !== chat.id)
      );
      await deleteCachedChat(cacheOwner, chat.id);
      if (activeChatIdRef.current === chat.id) newChat();
      setHistoryActionError('');
    } catch (error) {
      setHistoryActionError(
        error instanceof Error ? error.message : 'Could not delete the chat.'
      );
    }
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

      void saveCachedChat(cacheOwner, next[0]);
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

  async function syncGenerationConversation(
    conversationId: string,
    title: string,
    generationId: string,
    generationMessages: Message[]
  ): Promise<void> {
    if (!token || !navigator.onLine) {
      setHistorySyncState('offline');
      return;
    }
    try {
      const response = await fetch(
        `${apiBase}/conversations/${encodeURIComponent(conversationId)}/messages/sync`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            title,
            generationId,
            messages: generationMessages.map((message) => ({
              id: message.id,
              role: message.role,
              content: message.text,
              status: message.status || 'completed',
              createdAt: message.createdAt || new Date().toISOString()
            }))
          })
        }
      );
      if (!response.ok) throw new Error('Generation history sync failed.');
      setHistorySyncState('synced');
    } catch {
      setHistorySyncState('failed');
    }
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
      const assistantMessageId = makeId();
      const idempotencyKey = makeId();
      try {
        const reply = await onChat(
          request,
          chatHistory,
          attachedImage,
          {
            conversationId: requestChatId,
            userMessageId: userMessage.id,
            assistantMessageId,
            idempotencyKey
          }
        );
        appendMessageToChat(
          requestChatId,
          pendingMessages,
          {
            ...createMessage('assistant', reply.text, {
              processingDurationMs: reply.processingDurationMs,
              tokenUsage: reply.tokenUsage
            }),
            id: assistantMessageId,
            provider: reply.provider || null,
            model: reply.model || null
          }
        );
      } catch (chatError) {
        const text = chatError instanceof Error ? chatError.message : 'Assistant request failed.';
        appendMessageToChat(
          requestChatId,
          pendingMessages,
          {
            ...createMessage('assistant', `Assistant error: ${text}`),
            id: assistantMessageId,
            status: 'failed'
          }
        );
      }
      return;
    }

    let authoritativeDurationMs: number | null = null;
    let generationJobId: string | null = null;
    try {
      const generated = await onGenerate(
        request,
        attachedImage,
        (nextActivity) => {
          generationJobId = nextActivity.jobId;
          authoritativeDurationMs =
            typeof nextActivity.durationMs === 'number'
              ? nextActivity.durationMs
              : authoritativeDurationMs;
          setChatActivities((current) => ({
            ...current,
            [requestChatId]: nextActivity
          }));
        }
      );

      if (!generated) {
        throw new Error(
          'Website generation failed without an error message.'
        );
      }

      setHasProject(true);
      generationJobId = generated.jobId || generationJobId;
      const generatedMessage = createMessage(
        'assistant',
        `${generated.projectName} is ready. ` +
          'The project was generated and validated.',
        {
          processingDurationMs: authoritativeDurationMs,
          tokenUsage: null,
          operation: 'generation'
        }
      );
      appendMessageToChat(
        requestChatId,
        pendingMessages,
        generatedMessage
      );
      if (generationJobId) {
        void syncGenerationConversation(
          requestChatId,
          request.replace(/\s+/g, ' ').slice(0, 80),
          generationJobId,
          [userMessage, generatedMessage]
        );
      }
    } catch (buildError) {
      const buildMessage =
        buildError instanceof Error
          ? buildError.message
          : 'Website generation failed.';

      const failedMessage = {
        ...createMessage(
          'assistant',
          `Build failed: ${buildMessage}\n\n` +
            'Check your connection and try again.',
          {
            processingDurationMs: authoritativeDurationMs,
            tokenUsage: null,
            operation: 'generation'
          }
        ),
        status: 'failed' as const
      };
      appendMessageToChat(
        requestChatId,
        pendingMessages,
        failedMessage
      );
      if (generationJobId) {
        void syncGenerationConversation(
          requestChatId,
          request.replace(/\s+/g, ' ').slice(0, 80),
          generationJobId,
          [userMessage, failedMessage]
        );
      }
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
          <small>
            {!token
              ? 'Guest chats stay on this device and do not survive uninstall'
              : historySyncState === 'loading'
              ? 'Loading cached chats…'
              : historySyncState === 'synced'
                ? 'Synced across your account'
                : historySyncState === 'offline'
                  ? 'Offline — showing cached chats'
                  : 'Sync failed — showing cached chats'}
          </small>
          {historyActionError && (
            <small role="alert">{historyActionError}</small>
          )}
          {savedChats.length === 0 ? (
            <small>
              {historySyncState === 'loading'
                ? 'Checking history…'
                : 'No saved chats yet'}
            </small>
          ) : (
            savedChats.map((chat) => (
              <div key={chat.id} className="claude-saved-chat-row">
                <button
                  type="button"
                  onClick={() => void openSavedChat(chat)}
                >
                  {chat.title}
                </button>
                <button
                  type="button"
                  aria-label={`Rename ${chat.title}`}
                  onClick={() => void renameChat(chat)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${chat.title}`}
                  onClick={() => void removeChat(chat)}
                >
                  ×
                </button>
              </div>
            ))
          )}
          {nextConversationCursor && (
            <button
              type="button"
              onClick={() => void loadOlderConversations()}
            >
              Load older chats
            </button>
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
              {messageCursors[activeChatId] && (
                <button
                  type="button"
                  onClick={() => void loadEarlierMessages()}
                >
                  Load earlier messages
                </button>
              )}
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
                          {formatProcessingDuration(
                            message.processingDurationMs,
                            message.operation
                          ) && (
                            <span>
                              {formatProcessingDuration(
                                message.processingDurationMs,
                                message.operation
                              )}
                            </span>
                          )}
                          {typeof message.tokenUsage?.totalTokens === 'number' && (
                            <span>{formatTokenUsage(message.tokenUsage)}</span>
                          )}
                          {message.status === 'failed' && (
                            <span>Failed</span>
                          )}
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
