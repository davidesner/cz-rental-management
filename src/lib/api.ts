export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) { super(`API ${status}`); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => res.statusText);
    throw new ApiError(res.status, parsed);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b: unknown) => request<T>('POST', p, b),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  delete: <T>(p: string) => request<T>('DELETE', p),
};

/**
 * The message to show a user for a failed request.
 *
 * `ApiError.message` is only ever the string `API <status>` — the server's real
 * message lives in `body.error.message` (see server/middleware/errors.ts, which
 * serialises an AppError as `{ error: { kind, message, details } }`). So the
 * common `e instanceof Error ? e.message : String(e)` idiom renders "API 422"
 * and throws away the actual explanation.
 */
export function apiErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body as { error?: { message?: string } } | undefined;
    if (typeof body?.error?.message === 'string' && body.error.message !== '') {
      return body.error.message;
    }
    return `Chyba ${e.status}`;
  }
  return e instanceof Error ? e.message : String(e);
}
