import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';

interface ModalProps {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Panel width class. Default is the form width. */
  className?: string;
  /** Buttons row at the bottom. */
  footer?: ReactNode;
}

/**
 * A centred dialog over a scrim. Built on Radix Dialog so focus moves into the
 * panel, stays there, and returns to the opener; Escape and a click outside
 * close it.
 */
export function Modal({ title, description, onClose, children, className, footer }: ModalProps) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)]" />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content
            className={cn(
              'flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border border-line bg-card text-ink shadow-pop focus:outline-none',
              'font-[inherit]',
              className,
            )}
            onPointerDownOutside={() => onClose()}
          >
            <div className="px-5 pb-3 pt-5">
              <Dialog.Title className="m-0 text-[17px] font-semibold leading-tight">{title}</Dialog.Title>
              {description
                ? <Dialog.Description className="mt-1 text-sm text-soft">{description}</Dialog.Description>
                : <Dialog.Description className="sr-only">Dialog</Dialog.Description>}
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule px-5 py-3">{footer}</div>}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
