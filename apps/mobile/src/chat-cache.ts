export type CachedChat<TMessage = unknown, TActivity = unknown> = {
  id: string;
  title: string;
  updatedAt: number;
  messages: TMessage[];
  activity?: TActivity | null;
};

const DATABASE_NAME = 'nexora-chat-cache';
const DATABASE_VERSION = 1;
const STORE_NAME = 'conversations';

type StoredChat = CachedChat & {
  cacheKey: string;
  ownerKey: string;
};

function normalizedOwner(value: string): string {
  return value.trim().toLowerCase() || 'guest';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
      if (!store.indexNames.contains('ownerKey')) {
        store.createIndex('ownerKey', 'ownerKey', { unique: false });
      }
      if (!store.indexNames.contains('updatedAt')) {
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Chat cache unavailable.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error('Chat cache transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error || new Error('Chat cache transaction aborted.'));
  });
}

export async function loadCachedChats<TMessage, TActivity>(
  owner: string
): Promise<Array<CachedChat<TMessage, TActivity>>> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const index = transaction.objectStore(STORE_NAME).index('ownerKey');
    const request = index.getAll(normalizedOwner(owner));
    const rows = await new Promise<StoredChat[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredChat[]);
      request.onerror = () =>
        reject(request.error || new Error('Could not read chat cache.'));
    });
    await transactionDone(transaction);
    return rows
      .map(({ cacheKey: _cacheKey, ownerKey: _ownerKey, ...chat }) =>
        chat as CachedChat<TMessage, TActivity>
      )
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } finally {
    database.close();
  }
}

export async function saveCachedChat<TMessage, TActivity>(
  owner: string,
  chat: CachedChat<TMessage, TActivity>
): Promise<void> {
  const ownerKey = normalizedOwner(owner);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({
      ...chat,
      ownerKey,
      cacheKey: `${ownerKey}:${chat.id}`
    });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteCachedChat(
  owner: string,
  conversationId: string
): Promise<void> {
  const ownerKey = normalizedOwner(owner);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction
      .objectStore(STORE_NAME)
      .delete(`${ownerKey}:${conversationId}`);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
