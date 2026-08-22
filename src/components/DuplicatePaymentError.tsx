import { ApiError, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface DuplicatePaymentErrorProps {
  error: unknown;
  onForce: () => void;
  pending?: boolean;
}

/**
 * Renders a failed payment-save error and, only when the server refused with a
 * 409 conflict (the duplicate guard in core/services/payment.ts), a secondary
 * "Přesto zapsat" affordance that retries the same submission with
 * `allowDuplicate: true`.
 *
 * Any other failure (validation, network, 500, …) shows the message with no
 * override — only a genuine duplicate conflict has one, and `ApiError.status`
 * is what tells the two apart.
 *
 * The retry is deliberate, never automatic: the message shown is the server's
 * own explanation, which names the existing payment's id, source and VS — the
 * detail a human needs to tell a genuine second transfer from a mistake.
 *
 * This component has no memory of its own: callers own `error` and must clear
 * it whenever the dialog's inputs change, so a corrected amount can never
 * silently carry forward a stale "yes, duplicate" decision from a previous
 * submission.
 */
export function DuplicatePaymentError({ error, onForce, pending }: DuplicatePaymentErrorProps) {
  if (!error) return null;
  const isDuplicateConflict = error instanceof ApiError && error.status === 409;
  return (
    <div className="space-y-2">
      <p className="text-sm text-destructive">{apiErrorMessage(error)}</p>
      {isDuplicateConflict && (
        <Button type="button" variant="outline" size="sm" onClick={onForce} disabled={pending}>
          Přesto zapsat
        </Button>
      )}
    </div>
  );
}
