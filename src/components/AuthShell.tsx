import type { ReactNode } from 'react';

/** Centred single panel for the pages outside the app shell (sign-in, password change, consent). */
export function AuthShell({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page p-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-5 flex items-center gap-2.5 px-1">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
            <path d="M3 10.5 12 3l9 7.5V21H3z" /><path d="M9 21v-6h6v6" />
          </svg>
          <span className="font-semibold">Správa pronájmu</span>
        </div>
        <div className="rounded-xl border border-line bg-card p-6">
          <h1 className="m-0 text-[20px] font-semibold tracking-[-0.01em]">{title}</h1>
          {description && <p className="mt-1 text-sm text-soft">{description}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
