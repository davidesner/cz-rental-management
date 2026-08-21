#!/usr/bin/env python3
"""Build a committable test fixture from a real KB payment notification.

The real mail contains actual account numbers, the recipient's address and
single-use click-tracking URLs, none of which may enter the repo. This rebuilds
the message with the same headers and structure but placeholder values, so the
parser is exercised against KB's real HTML shape without leaking anything.

Usage:
    python3 scripts/sanitize-kb-fixture.py <source.eml> tests/fixtures/kb-payment-notification.eml
"""
import email
import itertools
import re
import sys
from email import policy
from email.message import EmailMessage

FROM_ACCOUNT = '123-1234567890/0100'   # payer (tenant)
TO_ACCOUNT = '321-9876543210/0100'     # payee (landlord)
TRACKER = 'https://link.kbinfo.cz/f/a/FIXTURE~~/AAAAARA~/FIXTUREFIXTUREFIXTURE~'


def sanitize(html: str) -> str:
    # Accounts appear in document order: from, to (Czech block), then from, to
    # (English block). Cycle placeholders so both blocks stay consistent, which
    # matters because the parser cross-checks the two halves.
    accounts = itertools.cycle([FROM_ACCOUNT, TO_ACCOUNT])
    html = re.sub(r'\d{1,6}-\d{6,10}/\d{4}', lambda _: next(accounts), html)
    # Click-trackers are single-use and identify the recipient.
    html = re.sub(r'https://link\.kbinfo\.cz/[^"\']+', TRACKER, html)
    # Any surviving e-mail address that isn't KB's own public contact.
    html = re.sub(r'[\w.+-]+@(?!kb\.cz|kbinfo\.cz)[\w.-]+\.\w+', 'landlord@example.com', html)
    # Google Fonts' variable-weight query param ("wght@400;500;600") isn't PII,
    # but its bare "word@digits" shape false-positives on the e-mail-address
    # verification grep below. Collapse it so that check stays a clean signal.
    html = re.sub(r'wght@[\d;]+', 'wght', html)
    return html


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, out = sys.argv[1], sys.argv[2]
    msg = email.message_from_binary_file(open(src, 'rb'), policy=policy.default)
    html = next(p.get_content() for p in msg.walk() if p.get_content_type() == 'text/html')

    fixture = EmailMessage()
    fixture['From'] = 'Komerční banka <servis@kbinfo.cz>'
    fixture['Reply-To'] = 'Komerční banka <kbplus@kb.cz>'
    fixture['To'] = 'landlord@example.com'
    fixture['Subject'] = 'Servisní zpráva: Přijali jsme platbu na Váš účet'
    fixture['Date'] = 'Thu, 20 Aug 2026 10:52:24 +0000'
    fixture['Message-ID'] = '<FIXTURE-0001@example.invalid>'
    fixture.set_content(sanitize(html), subtype='html', charset='utf-8', cte='quoted-printable')

    with open(out, 'wb') as fh:
        fh.write(fixture.as_bytes())
    print(f'wrote {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
