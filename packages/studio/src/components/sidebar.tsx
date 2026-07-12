'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isGatewayConnected } from '@/lib/api';

const navItems = [
  { href: '/', label: 'Dashboard', icon: DashboardIcon },
  { href: '/agents', label: 'Agents', icon: AgentsIcon },
  { href: '/workflows', label: 'Workflows', icon: WorkflowIcon },
  { href: '/memory', label: 'Memory', icon: MemoryIcon },
  { href: '/events', label: 'Events', icon: EventsIcon },
  { href: '/plugins', label: 'Plugins', icon: PluginsIcon },
  { href: '/context', label: 'Context', icon: ContextIcon },
  { href: '/deploy', label: 'Deploy', icon: DeployIcon },
  { href: '/monitoring', label: 'Monitoring', icon: MonitorIcon },
  { href: '/logs', label: 'Logs', icon: LogsIcon },
  { href: '/permissions', label: 'Permissions', icon: PermIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const check = async () => setConnected(await isGatewayConnected());
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <aside className="w-60 h-screen bg-zinc-950/80 backdrop-blur-xl border-r border-zinc-800/60 flex flex-col fixed left-0 top-0 z-50">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-zinc-800/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-kernova-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-kernova-600/20">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-white">
              <path d="M8 1L14.9282 5V11L8 15L1.07179 11V5L8 1Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <circle cx="8" cy="8" r="2.5" fill="currentColor" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white tracking-tight">Kernova Studio</h1>
            <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Developer Platform</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 group ${
                isActive
                  ? 'bg-kernova-600/15 text-kernova-300 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              <Icon active={isActive} />
              <span>{item.label}</span>
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-kernova-400" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Connection Status Footer */}
      <div className="px-4 py-3 border-t border-zinc-800/60">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse-dot' : 'bg-zinc-600'}`} />
          <span className="text-[11px] text-zinc-500 font-medium">
            {connected ? 'Gateway connected' : 'Gateway offline'}
          </span>
        </div>
      </div>
    </aside>
  );
}

// ─── Icon Components ─────────────────────────────────────────────

function DashboardIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? 'text-kernova-400' : 'text-zinc-500 group-hover:text-zinc-400'}>
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function AgentsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? 'text-kernova-400' : 'text-zinc-500 group-hover:text-zinc-400'}>
      <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 14C2.5 11 5 9 8 9C11 9 13.5 11 13.5 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function WorkflowIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? 'text-kernova-400' : 'text-zinc-500 group-hover:text-zinc-400'}>
      <circle cx="3" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 7.5L11 4.5M5 8.5L11 11.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function MemoryIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? 'text-kernova-400' : 'text-zinc-500 group-hover:text-zinc-400'}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 6.5H11M5 9H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function EventsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? 'text-kernova-400' : 'text-zinc-500 group-hover:text-zinc-400'}>
      <path d="M9 1L4 9H8L7 15L12 7H8L9 1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function PluginsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? 'text-kernova-400' : 'text-zinc-500 group-hover:text-zinc-400'}>
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10 11H13M11.5 9.5V12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ContextIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? 'text-kernova-400' : 'text-zinc-500 group-hover:text-zinc-400'}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 2V4M8 12V14M2 8H4M12 8H14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function DeployIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? 'text-kernova-400' : 'text-zinc-500 group-hover:text-zinc-400'}>
      <path d="M8 2L8 10M8 10L5 7M8 10L11 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12H13V14H3V12Z" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function MonitorIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? 'text-kernova-400' : 'text-zinc-500 group-hover:text-zinc-400'}>
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 8L6 6L8.5 8.5L12 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 14H10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function LogsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? 'text-kernova-400' : 'text-zinc-500 group-hover:text-zinc-400'}>
      <path d="M2 4H14M2 8H14M2 12H10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function PermIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? 'text-kernova-400' : 'text-zinc-500 group-hover:text-zinc-400'}>
      <rect x="4" y="7" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 7V5C6 3.9 6.9 3 8 3C9.1 3 10 3.9 10 5V7" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}
