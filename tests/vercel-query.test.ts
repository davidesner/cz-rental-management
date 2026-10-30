import { describe, expect, it } from 'vitest';
import { stripInjectedPathParam } from '../server/vercel-query.js';

describe('stripInjectedPathParam', () => {
  it('removes the capture Vercel injects for /api/:path*', () => {
    expect(stripInjectedPathParam('/api/auth/oauth2/authorize?client_id=a&sig=s&path=auth/oauth2/authorize'))
      .toBe('/api/auth/oauth2/authorize?client_id=a&sig=s');
  });

  it('removes it for /.well-known/ too, leaving no empty query', () => {
    expect(stripInjectedPathParam('/.well-known/oauth-protected-resource/mcp?path=oauth-protected-resource/mcp'))
      .toBe('/.well-known/oauth-protected-resource/mcp');
  });

  it('keeps a caller-supplied path with another value', () => {
    const target = '/api/files?path=docs/a.pdf';
    expect(stripInjectedPathParam(target)).toBe(target);
  });

  it('leaves targets without a path parameter untouched', () => {
    const target = '/api/properties?x=1';
    expect(stripInjectedPathParam(target)).toBe(target);
  });
});
