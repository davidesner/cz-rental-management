import { describe, it, expect } from 'vitest';
import { parseKbPaymentNotification, extractSpanTokens, matchesFilters } from '../core/lib/kb-email-parser.js';
import { loadFixtureEml, loadFixtureHtml, makeEml, setFieldValue } from './helpers/kb-email.js';

const FILTERS = { fromFilter: 'servis@kbinfo.cz', subjectFilter: 'Přijali jsme platbu' };

async function parse(raw: Buffer) {
  return parseKbPaymentNotification(raw, FILTERS);
}

describe('kb-email-parser', () => {
  it('parses the real notification shape, with every symbol empty', async () => {
    const res = await parse(await loadFixtureEml());
    if (!res.ok) throw new Error(`expected ok, got ${res.reason}: ${res.detail}`);

    expect(res.value.amount).toBe(3000);            // 30,00 Kč
    expect(res.value.currency).toBe('CZK');
    expect(res.value.valueDate).toBe('2026-08-20'); // Splatnost: 20. 08. 2026
    expect(res.value.fromAccount).toBe('123-1234567890/0100');
    expect(res.value.toAccount).toBe('321-9876543210/0100');
    // THE point of positional parsing: empty values must be null, not the
    // following label.
    expect(res.value.vs).toBeNull();
    expect(res.value.ks).toBeNull();
    expect(res.value.ss).toBeNull();
    expect(res.value.messageForRecipient).toBeNull();
    expect(res.value.messageId).toBe('FIXTURE-0001@example.invalid');
    expect(res.value.sourceLink).toContain('link.kbinfo.cz');
    expect(res.value.tokens.length).toBeGreaterThan(20);
  });

  it('reads populated symbols and the message', async () => {
    let html = await loadFixtureHtml();
    html = setFieldValue(html, 'Zpráva pro příjemce', 'najem 8/2026');
    html = setFieldValue(html, 'Variabilní symbol', '2026008');
    html = setFieldValue(html, 'Konstantní symbol', '0308');
    html = setFieldValue(html, 'Specifický symbol', '77');

    const res = await parse(makeEml(html));
    if (!res.ok) throw new Error(`expected ok, got ${res.reason}: ${res.detail}`);
    expect(res.value.messageForRecipient).toBe('najem 8/2026');
    expect(res.value.vs).toBe('2026008');
    expect(res.value.ks).toBe('0308');
    expect(res.value.ss).toBe('77');
  });

  it('handles a thousands separator (NBSP) in the amount', async () => {
    const html = (await loadFixtureHtml())
      .replace('30,00&nbsp;Kč', '35 000,00&nbsp;Kč')
      .replace('30,00 Kč', '35 000,00 Kč')
      .replace('30.00 CZK', '35,000.00 CZK');
    const res = await parse(makeEml(html));
    if (!res.ok) throw new Error(`expected ok, got ${res.reason}: ${res.detail}`);
    expect(res.value.amount).toBe(3_500_000);
  });

  it('reports the currency without judging it', async () => {
    const html = (await loadFixtureHtml())
      .replace(/30,00(&nbsp;| )Kč/, '30,00$1EUR')
      .replace('30.00 CZK', '30.00 EUR');
    const res = await parse(makeEml(html));
    if (!res.ok) throw new Error(`expected ok, got ${res.reason}: ${res.detail}`);
    // Policy lives in the sync service, not here.
    expect(res.value.currency).toBe('EUR');
  });

  it('refuses when the Czech and English halves disagree on the amount', async () => {
    const html = (await loadFixtureHtml()).replace('30.00 CZK', '40.00 CZK');
    const res = await parse(makeEml(html));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('cz_en_mismatch');
  });

  it('refuses when the halves disagree on the date', async () => {
    const html = (await loadFixtureHtml()).replace('08-20-2026', '08-21-2026');
    const res = await parse(makeEml(html));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('cz_en_mismatch');
  });

  it('rejects a mail whose English mirror is missing only its due date', async () => {
    // The amount stays; only the due-date value disappears from the English
    // span. Structure must catch this even though the amount check still
    // passes — this is the gap the amount-only assertion left open.
    const html = (await loadFixtureHtml()).replace('08-20-2026', '');
    const res = await parse(makeEml(html));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('unexpected_structure');
    expect(res.detail).toMatch(/due date/i);
  });

  describe('value date validation', () => {
    it('rejects an impossible Splatnost date instead of persisting nonsense', async () => {
      const html = (await loadFixtureHtml()).replace('20. 08. 2026', '32. 13. 2026');
      const res = await parse(makeEml(html));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe('missing_value_date');
    });

    it('still accepts a real leap-day date (29 Feb on a leap year)', async () => {
      const html = (await loadFixtureHtml())
        .replace('20. 08. 2026', '29. 02. 2024')
        .replace('08-20-2026', '02-29-2024');
      const res = await parse(makeEml(html));
      if (!res.ok) throw new Error(`expected ok, got ${res.reason}: ${res.detail}`);
      expect(res.value.valueDate).toBe('2024-02-29');
    });
  });

  describe('structural validation', () => {
    it('rejects a renamed label and names the failed assertion', async () => {
      const html = (await loadFixtureHtml()).replace('Variabilní symbol', 'Variabilni symbol XX');
      const res = await parse(makeEml(html));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe('unexpected_structure');
      expect(res.detail).toContain('Variabilní symbol');
      // The tokens survive, so the row is still storable and re-parseable.
      expect(res.tokens.length).toBeGreaterThan(10);
      expect(res.messageId).toBe('FIXTURE-0001@example.invalid');
    });

    it('rejects reordered labels — order is asserted, not just presence', async () => {
      const html = (await loadFixtureHtml())
        .replace('Variabilní symbol', '@@TMP@@')
        .replace('Specifický symbol', 'Variabilní symbol')
        .replace('@@TMP@@', 'Specifický symbol');
      const res = await parse(makeEml(html));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe('unexpected_structure');
      expect(res.detail).toMatch(/order/i);
    });

    it('rejects a structure with no spans at all', async () => {
      const res = await parse(makeEml('<html><body><p>Přijali jsme platbu 30,00 Kč</p></body></html>'));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe('unexpected_structure');
    });

    it('rejects a label that is the last span, with no value slot', async () => {
      const tokens = ['Z účtu', '123-1/0100', 'Na účet', '321-2/0100',
        'Zpráva pro příjemce', '', 'Variabilní symbol', '', 'Konstantní symbol', '',
        'Specifický symbol'];
      const html = `<html><body>${tokens.map(t => `<span>${t}</span>`).join('')}</body></html>`;
      const res = await parse(makeEml(html));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe('unexpected_structure');
    });
  });

  describe('sender and subject gating', () => {
    it('rejects an unrelated sender', async () => {
      const res = await parse(makeEml(await loadFixtureHtml(), { from: 'newsletter@example.com' }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      // Benign — must be distinguishable from unexpected_structure so the sync
      // does not escalate the integration to an error state.
      expect(res.reason).toBe('not_kb_notification');
    });

    it('rejects an unrelated subject', async () => {
      const res = await parse(makeEml(await loadFixtureHtml(), { subject: 'Výpis z účtu' }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe('not_kb_notification');
    });

    it('matches the subject case- and diacritic-insensitively', async () => {
      const res = await parse(makeEml(await loadFixtureHtml(), {
        subject: 'Servisni zprava: PRIJALI JSME PLATBU na Vas ucet',
      }));
      expect(res.ok).toBe(true);
    });
  });

  describe('extractSpanTokens', () => {
    it('preserves empty spans, which is what makes positional reads work', () => {
      const tokens = extractSpanTokens('<span>A</span><span></span><span>B</span>');
      expect(tokens).toEqual(['A', '', 'B']);
    });

    it('strips invisible padding characters KB injects', () => {
      // \u00a0 NBSP, \ufeff BOM, \u034f grapheme joiner, \u200b zero-width space —
      // spelled as escapes so this test stays reviewable.
      const raw = '<span>\u00a0\ufeff\u034f 30,00\u00a0Kč \u200b</span>';
      expect(extractSpanTokens(raw)).toEqual(['30,00 Kč']);
    });

    it('flattens nested markup inside a span', () => {
      const tokens = extractSpanTokens('<span><a><font>Z účtu</font></a></span>');
      expect(tokens).toEqual(['Z účtu']);
    });
  });

  describe('matchesFilters', () => {
    const from = '"KB info" <servis@kbinfo.cz>';
    const subject = 'Přijali jsme platbu na Váš účet';

    it('matches an exact sender and subject', () => {
      expect(matchesFilters(from, subject, FILTERS)).toBe(true);
    });

    it('matches a diacritic-stripped subject', () => {
      expect(matchesFilters(from, 'Prijali jsme platbu na Vas ucet', FILTERS)).toBe(true);
    });

    it('matches regardless of case', () => {
      expect(matchesFilters(from.toUpperCase(), subject.toUpperCase(), FILTERS)).toBe(true);
    });

    it('rejects a non-matching sender', () => {
      expect(matchesFilters('"Newsletter" <newsletter@example.com>', subject, FILTERS)).toBe(false);
    });

    it('rejects a non-matching subject', () => {
      expect(matchesFilters(from, 'Výpis z účtu', FILTERS)).toBe(false);
    });
  });
});
