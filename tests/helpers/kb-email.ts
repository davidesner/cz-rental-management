// Helpers for building parser test inputs from the one committed fixture.
//
// Only ONE .eml is committed: the real KB shape, sanitized. Every variant
// (populated symbols, drifted template, currency change) is derived from it at
// runtime, so there is a single source of truth for what KB's HTML looks like.
import { readFile } from 'node:fs/promises';
import { simpleParser } from 'mailparser';

const FIXTURE = new URL('../fixtures/kb-payment-notification.eml', import.meta.url);

export async function loadFixtureEml(): Promise<Buffer> {
  return readFile(FIXTURE);
}

export async function loadFixtureHtml(): Promise<string> {
  const parsed = await simpleParser(await loadFixtureEml());
  if (!parsed.html) throw new Error('fixture has no HTML part');
  return parsed.html;
}

export interface EmlOverrides {
  messageId?: string;
  date?: string;
  subject?: string;
  from?: string;
}

/** Wrap an HTML body into a minimal KB-shaped message. */
export function makeEml(html: string, o: EmlOverrides = {}): Buffer {
  const headers = [
    `From: ${o.from ?? 'Komerční banka <servis@kbinfo.cz>'}`,
    `To: landlord@example.com`,
    `Subject: ${o.subject ?? 'Servisní zpráva: Přijali jsme platbu na Váš účet'}`,
    `Date: ${o.date ?? 'Thu, 20 Aug 2026 10:52:24 +0000'}`,
    `Message-ID: ${o.messageId ?? '<FIXTURE-0001@example.invalid>'}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ].join('\r\n');
  return Buffer.from(`${headers}\r\n\r\n${html}`, 'utf8');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fill in the empty value span that follows `label`.
 *
 * KB renders both label and value as <font color="#212121">…</font>; the value
 * for an unset field is an empty one. This finds the first empty value font
 * after the label and injects text into it.
 */
export function setFieldValue(html: string, label: string, value: string): string {
  // The real markup's value <font> carries extra attributes (class, style)
  // around color="#212121", not just the bare attribute — hence the [^>]*.
  const re = new RegExp(`(${escapeRegex(label)}[\\s\\S]*?<font[^>]*color="#212121"[^>]*>)(</font>)`);
  if (!re.test(html)) throw new Error(`no empty value slot found after label "${label}"`);
  return html.replace(re, `$1${value}$2`);
}
