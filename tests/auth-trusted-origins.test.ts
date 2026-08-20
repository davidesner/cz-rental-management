import { describe, it, expect, afterEach } from 'vitest';
import { resolveTrustedOrigins } from '../core/auth/better-auth.js';

/**
 * Vercel serves every preview deployment on TWO hostnames:
 *   - VERCEL_URL        the per-deployment alias  (app-<hash>-<team>.vercel.app)
 *   - VERCEL_BRANCH_URL the branch alias          (app-git-<branch>-<team>.vercel.app)
 *
 * Better Auth rejects any request whose Origin is not trusted, and that check
 * only runs when the request carries cookies — which a browser always does and
 * curl does not. So a preview reached by its branch alias failed sign-in with
 * 403 "Invalid origin", while the same deployment reached by its per-deployment
 * URL worked, and neither curl nor the test suite noticed.
 */
const ENV_KEYS = [
  'BETTER_AUTH_TRUSTED_ORIGINS', 'VERCEL_URL', 'VERCEL_BRANCH_URL', 'VITEST',
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveTrustedOrigins on Vercel', () => {
  it('trusts the branch alias as well as the per-deployment URL', () => {
    // An explicit list is required to reach the Vercel branch at all: with none
    // set, VITEST short-circuits to the localhost origins.
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://rental.example';
    process.env.VERCEL_URL = 'app-m6vibjbtl-team.vercel.app';
    process.env.VERCEL_BRANCH_URL = 'app-git-perf-redu-5958e3-team.vercel.app';

    const origins = resolveTrustedOrigins('https://app-m6vibjbtl-team.vercel.app');

    expect(origins).toContain('https://app-m6vibjbtl-team.vercel.app');
    // The one that was missing — this is the hostname a human actually opens.
    expect(origins).toContain('https://app-git-perf-redu-5958e3-team.vercel.app');
    expect(origins).toContain('https://rental.example');
  });

  it('does not invent a branch origin when Vercel did not set one', () => {
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://rental.example';
    process.env.VERCEL_URL = 'app-m6vibjbtl-team.vercel.app';
    delete process.env.VERCEL_BRANCH_URL;

    const origins = resolveTrustedOrigins('https://app-m6vibjbtl-team.vercel.app');

    expect(origins).toEqual(['https://rental.example', 'https://app-m6vibjbtl-team.vercel.app']);
    expect(origins.some((o) => o.includes('undefined'))).toBe(false);
  });

  it('still short-circuits to localhost origins outside Vercel', () => {
    delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_BRANCH_URL;

    expect(resolveTrustedOrigins('http://localhost:3000'))
      .toEqual(['http://localhost:5173', 'http://localhost:3000']);
  });
});
