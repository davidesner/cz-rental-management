import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

// Data-driven on purpose. `bank_integration.kind` is a DB enum with exactly
// one value today ('kb_email'), but it exists as a discriminator so a second
// collection method (a real bank API, a different bank) becomes a new parser
// plus one more entry here — not a rewrite of this chooser or of
// IntegrationDialog. Each entry's `kind` must match the DB enum value.
export const METHODS = [
  {
    kind: 'kb_email' as const,
    title: 'KB+ e-mailové notifikace',
    description: 'Sbírá e-maily "Přijali jsme platbu" z Komerční banky přes IMAP. Potřebuješ mailbox, kam notifikace chodí, a App Password.',
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="text-xl font-semibold">Nová bankovní integrace</h2>
          <p className="text-sm text-muted-foreground mt-1">Vyber způsob, jakým se mají sbírat platby.</p>
        </div>

        <div className="space-y-2">
          {METHODS.map(m => (
            <button
              key={m.kind}
              type="button"
              onClick={() => onSelect(m.kind)}
              className="w-full text-left rounded-md border p-4 hover:bg-muted transition-colors"
            >
              <div className="font-medium">{m.title}</div>
              <div className="text-sm text-muted-foreground mt-1">{m.description}</div>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Zrušit</Button>
        </div>
      </Card>
    </div>
  );
}
