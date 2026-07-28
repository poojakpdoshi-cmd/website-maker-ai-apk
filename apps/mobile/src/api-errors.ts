export class ApiRequestError extends Error {
  readonly status: number | null;
  readonly kind:
    | 'network'
    | 'unauthorized'
    | 'validation'
    | 'rate-limit'
    | 'server'
    | 'request';

  constructor(
    message: string,
    status: number | null,
    kind: ApiRequestError['kind']
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.kind = kind;
  }
}

type ErrorBody = { error?: unknown };

function responseMessage(status: number, body: ErrorBody): string {
  const serverMessage =
    typeof body.error === 'string' ? body.error.trim() : '';

  if (status === 401 || status === 403) {
    return serverMessage || 'Your session is missing or expired. Log in again.';
  }

  if (status === 429) {
    return serverMessage || 'Too many requests. Wait a moment and try again.';
  }

  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return serverMessage || 'Check the entered details and try again.';
  }

  if (status >= 500) {
    return 'Nexora could not complete this request. Try again shortly.';
  }

  return serverMessage || `Request failed (${status}).`;
}

function responseKind(status: number): ApiRequestError['kind'] {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate-limit';
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return 'validation';
  }
  if (status >= 500) return 'server';
  return 'request';
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(input, init);
  } catch {
    throw new ApiRequestError(
      'Cannot reach Nexora. Check your internet connection and try again.',
      null,
      'network'
    );
  }

  const body = await response.json().catch(() => ({})) as ErrorBody;

  if (!response.ok) {
    throw new ApiRequestError(
      responseMessage(response.status, body),
      response.status,
      responseKind(response.status)
    );
  }

  return body as T;
}
