import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

// Data-driven on purpose. `bank_integration.kind` is a DB enum with exactly
// one value today ('kb_email'), but it exists as a discriminator so a second
// collection method (a real bank API, a different bank) becomes a new parser
// plus one more entry here — not a rewrite of this chooser or of
// IntegrationDialog. Each entry's `kind` must match the DB enum value.
export const METHODS = [
  {
    kind: 'kb_email' as const,
    title: 'E-mailové notifikace Komerční banky',
    description: 'Sbírá e-maily „Přijali jsme platbu“ z internetového bankovnictví přes IMAP. Potřebuješ schránku, kam notifikace chodí, a heslo pro aplikace.',
  },
] as const;

export type BankIntegrationKind = (typeof METHODS)[number]['kind'];

interface Props {
  onClose: () => void;
  onSelect: (kind: BankIntegrationKind) => void;
}

// Shown for "Nová integrace". Editing an existing integration skips this
// entirely and opens IntegrationDialog directly — kind is fixed at creation
// and cannot change.
export function IntegrationMethodChooser({ onClose, onSelect }: Props) {
  return (
    <Modal
      title="Nová bankovní integrace"
      description="Vyber způsob, jakým se mají sbírat platby."
      onClose={onClose}
      className="max-w-lg"
      footer={<Button variant="outline" onClick={onClose}>Zrušit</Button>}
    >
      <div className="space-y-2">
        {METHODS.map(m => (
          <button
            key={m.kind}
            type="button"
            onClick={() => onSelect(m.kind)}
            className="w-full rounded-lg border border-line p-4 text-left transition-colors hover:bg-side"
          >
            <div className="font-medium">{m.title}</div>
            <div className="mt-1 text-sm text-soft">{m.description}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
