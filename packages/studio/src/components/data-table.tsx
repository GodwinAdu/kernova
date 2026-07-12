interface Column {
  key: string;
  header: string;
  render?: (item: any) => React.ReactNode;
}

interface DataTableProps {
  columns: Column[];
  data: any[];
  emptyMessage?: string;
}

export function DataTable({
  columns,
  data,
  emptyMessage = 'No data available',
}: DataTableProps) {
  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800/60">
            {columns.map((col) => (
              <th key={col.key} className="text-left px-4 py-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/40">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-2xl text-zinc-700">⊘</span>
                  <p className="text-sm text-zinc-600">{emptyMessage}</p>
                </div>
              </td>
            </tr>
          ) : (
            data.map((item, i) => (
              <tr key={i} className="hover:bg-zinc-800/30 transition-colors">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-zinc-300">
                    {col.render ? col.render(item) : String(item[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
