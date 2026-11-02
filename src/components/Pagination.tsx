import { useState } from 'react';
export function usePage<T>(items: T[], size = 50) {
  const [state, setState] = useState({ items, page: 0 });
  const page = state.items === items ? Math.min(state.page, Math.max(0, Math.ceil(items.length / size) - 1)) : 0;
  return { visible: items.slice(page * size, (page + 1) * size), page, pages: Math.ceil(items.length / size), setPage: (next: number) => setState({ items, page: next }) };
}
export default function Pagination({ page, pages, setPage }: { page: number; pages: number; setPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <div className="flex gap-3 items-center p-3 text-sm border-t"><button className="border rounded px-3 py-1 disabled:opacity-30" disabled={!page} onClick={() => setPage(page - 1)}>Назад</button><span>Страница {page + 1} из {pages}</span><button className="border rounded px-3 py-1 disabled:opacity-30" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Далее</button></div>;
}
