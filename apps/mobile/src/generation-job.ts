export const activeGenerationJobKey = 'nexora-active-generation-job';

export type GenerationLaunchPayload = {
  email: string;
  installationId: string;
  prompt: string;
  image?: {
    mimeType: string;
    data: string;
    name?: string;
  };
  generationMode?: 'standard' | 'saas-motion';
  motionBrief?: string;
  motionFrameCount?: number;
  motionDurationSeconds?: number;
  thinkMax?: true;
};

// NEXORA_SAAS_MOTION_MODE_V1

export type GenerationJobState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

const databaseName = 'nexora-generation-state';
const storeName = 'launch-requests';

function openDatabase(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, 1);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error || new Error('Could not open generation storage.')
    );
  });
}

async function databaseOperation<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  const database = await openDatabase();
  if (!database) return null;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));

    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(
      request.error || new Error('Generation storage operation failed.')
    );
    transaction.oncomplete = () => database.close();
    transaction.onabort = () => {
      database.close();
      reject(
        transaction.error || new Error('Generation storage transaction failed.')
      );
    };
  });
}

export function normalizeGenerationStatus(value: unknown): GenerationJobState {
  const status = typeof value === 'string'
    ? value.trim().toLowerCase()
    : '';

  if (status === 'queued') return 'queued';
  if (status === 'running') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return 'unknown';
}

export async function saveGenerationLaunch(
  jobId: string,
  payload: GenerationLaunchPayload
): Promise<void> {
  await databaseOperation(
    'readwrite',
    (store) => store.put(payload, jobId)
  );
}

export async function loadGenerationLaunch(
  jobId: string
): Promise<GenerationLaunchPayload | null> {
  return databaseOperation<GenerationLaunchPayload>(
    'readonly',
    (store) => store.get(jobId)
  );
}

export async function removeGenerationLaunch(jobId: string): Promise<void> {
  await databaseOperation(
    'readwrite',
    (store) => store.delete(jobId)
  );
}

export function waitForGenerationPoll(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      window.removeEventListener('online', finish);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      resolve();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') finish();
    };
    const timer = window.setTimeout(finish, delayMs);

    window.addEventListener('online', finish, { once: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
  });
}
