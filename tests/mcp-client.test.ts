import { describe, it, expect, vi } from 'vitest';
import { RentalApiClient, RentalApiError } from '../mcp/client.js';

describe('RentalApiClient', () => {
  it('GET adds Bearer header and parses JSON', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const c = new RentalApiClient('http://x', 'tok', fetchMock as unknown as typeof fetch);
    const out = await c.get<{ ok: boolean }>('/api/me');
    expect(out.ok).toBe(true);
    const callArgs = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((callArgs[1] as RequestInit).headers).toMatchObject({
      authorization: 'Bearer tok',
    });
  });

  it('throws RentalApiError on non-2xx', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('{"error":{"kind":"forbidden"}}', {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const c = new RentalApiClient('http://x', 'tok', fetchMock as unknown as typeof fetch);
    await expect(c.get('/api/secret')).rejects.toBeInstanceOf(RentalApiError);
  });

  it('RentalApiError carries status and parsed body', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('{"error":{"kind":"not_found"}}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const c = new RentalApiClient('http://x', 'tok', fetchMock as unknown as typeof fetch);
    try {
      await c.get('/api/missing');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RentalApiError);
      const e = err as RentalApiError;
      expect(e.status).toBe(404);
      expect((e.body as { error: { kind: string } }).error.kind).toBe('not_found');
    }
  });

  it('POST sends body as JSON', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ organization: { id: '1', name: 'Test' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const c = new RentalApiClient('http://x', 'tok', fetchMock as unknown as typeof fetch);
    const out = await c.post<{ organization: { id: string; name: string } }>('/api/organizations', { name: 'Test' });
    expect(out.organization.name).toBe('Test');
    const postCallArgs = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((postCallArgs[1] as RequestInit).body).toBe(JSON.stringify({ name: 'Test' }));
  });

  it('handles 204 No Content gracefully', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const c = new RentalApiClient('http://x', 'tok', fetchMock as unknown as typeof fetch);
    const result = await c.delete<void>('/api/payments/123');
    expect(result).toBeUndefined();
  });

  it('preserves text body on non-JSON error response', async () => {
    const fetchMock = vi.fn(async () => new Response('Internal Server Error', { status: 500 }));
    const c = new RentalApiClient('http://x', 'tok', fetchMock as unknown as typeof fetch);
    try {
      await c.get('/api/broken');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RentalApiError);
      const e = err as RentalApiError;
      expect(e.body).toBe('Internal Server Error');
    }
  });
});
