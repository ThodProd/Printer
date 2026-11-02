export function groupBy<T>(items: T[], key: (item: T) => string | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) { const id = key(item); if (id === undefined) continue; const group = groups.get(id); if (group) group.push(item); else groups.set(id, [item]); }
  return groups;
}
