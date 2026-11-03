/** Czech names for the cost and utility kinds the API uses. */
export const KIND_LABEL: Record<string, string> = {
  services: 'Služby (SVJ)',
  electricity: 'Elektřina',
  gas: 'Plyn',
  internet: 'Internet',
  water: 'Voda',
  other: 'Ostatní',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}
