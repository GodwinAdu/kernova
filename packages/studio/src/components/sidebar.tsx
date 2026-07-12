'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Dashboard', icon: '◈' },
  { href: '/agents', label: 'Agents', icon: '⬡' },
  { href: '/workflows', label: 'Workflows', icon: '⎔' },
  { href: '/memory', label: 'Memory', icon: '◎' },
  { href: '/events', label: 'Events', icon: '⚡' },
  { href: '/plugins', label: 'Plugins', icon: '⧉' },
  { href: '/context', label: 'Context', icon: '◐' },
  { href: '/deploy', label: 'Deploy', icon: '▲' },
  { href: '/monitoring', label: 'Monitoring', icon: '◉' },
  { href: '/logs', label: 'Logs', icon: '☰' },
  { href: '/permissions', label: 'Permissions', icon: '⛊' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 h-screen bg-zinc-900 border-r border-zinc-800 flex flex-col fixed left-0 top-0">
      <div className="p-4 border-b border-zinc-800">
        <h1 className="text-lg font-bold text-white tracking-tight">
          <span className="text-blue-400">◆</span> Kernova Studio
        </h1>
        <p className="text-xs text-zinc-500 mt-0.5">Developer Dashboard</p>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-4 py-2 mx-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-300 font-medium'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-zinc-800">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          Gateway connected
        </div>
      </div>
    </aside>
  );
}
