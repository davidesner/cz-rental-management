/** A document reference as the user typed it: a link for URLs, plain text for file paths. */
export function DocRef({ value }: { value: string | null }) {
  if (!value) return <span className="text-soft">—</span>;
  const isUrl = /^https?:\/\//.test(value);
  if (isUrl) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="inline-block max-w-[200px] truncate align-bottom text-sm" title={value}>
        {(() => { try { return new URL(value).hostname; } catch { return value; } })()}
      </a>
    );
  }
  return <span className="inline-block max-w-[200px] truncate align-bottom text-sm text-soft" title={value}>{value}</span>;
}
