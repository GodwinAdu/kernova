interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export function StatCard({ title, value, subtitle, icon, trend }: StatCardProps) {
  const trendColor = trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-amber-400' : 'text-zinc-500';
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—';

  return (
    <div className="glass-card rounded-xl p-4 hover:border-zinc-700/80 transition-all duration-200 hover:shadow-lg hover:shadow-zinc-900/20 group">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">{title}</p>
          <p className="text-2xl font-semibold text-white tabular-nums">{value}</p>
          {subtitle && (
            <p className={`text-[11px] flex items-center gap-1 ${trendColor}`}>
              <span>{trendIcon}</span> {subtitle}
            </p>
          )}
        </div>
        {icon && (
          <span className="text-xl text-zinc-700 group-hover:text-zinc-500 transition-colors">{icon}</span>
        )}
      </div>
    </div>
  );
}
