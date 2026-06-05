export class RentalApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'RentalApiError';
  }
}

export class RentalApiClient {
  constructor(
    public readonly baseUrl: string,
    public readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let parsed: unknown = await res.text();
      try {
        parsed = JSON.parse(parsed as string);
      } catch {
        /* keep as text */
      }
      throw new RentalApiError(res.status, parsed, `${method} ${path} -> ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  get<T>(path: string): Promise<T> {
    return this.req<T>('GET', path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.req<T>('POST', path, body);
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.req<T>('PATCH', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.req<T>('DELETE', path);
  }
}
