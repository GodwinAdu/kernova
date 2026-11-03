/**
 * kernova studio
 * 
 * Launches Kernova Studio — a visual developer dashboard that connects
 * to your running Kernova Gateway for real-time agent management.
 * 
 * Usage:
 *   kernova studio              → starts studio on port 4200
 *   kernova studio --port 8080  → custom port
 *   kernova studio --gateway http://localhost:3000  → custom gateway URL
 *   kernova studio --token <token>  → gateway token (default: $KERNOVA_API_KEY)
 *
 * The browser talks only to this server: API calls go to /__gateway/*, which is
 * forwarded to the gateway with the token added here, so the token never reaches the page.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve, join, sep } from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { info, warn, success } from '../ui.js';

/** Path prefix the Studio page uses for gateway API calls */
const PROXY_PREFIX = '/__gateway';
/** Header the Studio page sends with API calls. Other sites can't send it without a CORS preflight, which this server never approves */
const STUDIO_HEADER = 'x-kernova-studio';
/** Largest request body forwarded to the gateway */
const MAX_PROXY_BODY = 1_048_576;

interface Gateway {
  url: string;
  token?: string;
}

export async function handleStudio(args: string[]): Promise<void> {
  const options = parseStudioArgs(args);

  if (options.help) {
    printStudioHelp();
    return;
  }

  const port = options.port || 4200;
  const gateway: Gateway = {
    url: (options.gateway || 'http://localhost:3000').replace(/\/$/, ''),
    token: options.token || process.env.KERNOVA_API_KEY,
  };

  info(`Starting Kernova Studio on port ${port}...`);
  info(`Gateway: ${gateway.url}`);
  if (!gateway.token) {
    warn('No gateway token (--token or KERNOVA_API_KEY). Only a gateway with allowAnonymous will answer.');
  }

  // Try to find pre-built studio assets
  const studioDistDir = findStudioDist();

  if (studioDistDir) {
    // Serve pre-built static assets
    await serveStaticStudio(studioDistDir, port, gateway);
  } else {
    // No pre-built assets — serve an embedded lightweight Studio
    await serveEmbeddedStudio(port, gateway);
  }
}

/**
 * Forward the page's API calls (/__gateway/...) to the gateway, adding the token.
 * Only requests to this server on a local hostname that carry the Studio header are forwarded,
 * so other websites (CSRF) and DNS-rebound hostnames can't use the token.
 * Returns false for requests that aren't API calls.
 */
function proxyToGateway(req: IncomingMessage, res: ServerResponse, gateway: Gateway, port: number): boolean {
  if (!req.url?.startsWith(`${PROXY_PREFIX}/`)) return false;

  const sendError = (status: number, message: string) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  };

  const localHosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  if (!localHosts.includes(req.headers.host ?? '') || req.headers[STUDIO_HEADER] !== '1') {
    sendError(403, 'Forbidden');
    return true;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_PROXY_BODY) req.destroy();
    else chunks.push(chunk);
  });
  req.on('end', async () => {
    const method = req.method ?? 'GET';
    try {
      const upstream = await fetch(`${gateway.url}${req.url!.slice(PROXY_PREFIX.length)}`, {
        method,
        headers: {
          ...(req.headers['content-type'] && { 'Content-Type': req.headers['content-type'] }),
          ...(gateway.token && { Authorization: `Bearer ${gateway.token}` }),
        },
        body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
      });
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      sendError(502, `Gateway unreachable at ${gateway.url}: ${(err as Error).message}`);
    }
  });
  return true;
}

/**
 * Try to find the static Studio export (built from packages/studio with `next build`).
 * Checks the copy bundled into this package first, then the monorepo source.
 */
function findStudioDist(): string | null {
  const candidates = [
    resolve(import.meta.dirname, '../../studio'),          // bundled: @kernova/cli/studio
    resolve(import.meta.dirname, '../../../studio/out'),   // monorepo: packages/studio/out
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir;
  }

  return null;
}

/**
 * Point the static Studio at this server's gateway proxy before its scripts run.
 * Read by packages/studio/src/lib/api.ts.
 */
function injectGatewayUrl(html: string): string {
  return html.replace('<head>', `<head><script>window.__KERNOVA_GATEWAY__=${JSON.stringify(PROXY_PREFIX)}</script>`);
}

/**
 * Serve the embedded Studio — a single-page app that connects to the Gateway API.
 * No build step required. Ships as part of @kernova/cli.
 */
async function serveEmbeddedStudio(port: number, gateway: Gateway): Promise<void> {
  const html = generateStudioHtml();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (proxyToGateway(req, res, gateway, port)) return;

    // Serve the SPA for all routes
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  // Local only: the proxy adds the gateway token to requests
  server.listen(port, '127.0.0.1', () => {
    success(`Kernova Studio is running!`);
    console.log('');
    console.log(`  ◆ Local:    http://localhost:${port}`);
    console.log(`  ◆ Gateway:  ${gateway.url}`);
    console.log('');
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    server.close();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

/**
 * Serve pre-built Next.js static export
 */
async function serveStaticStudio(distDir: string, port: number, gateway: Gateway): Promise<void> {
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  };

  const root = resolve(distDir);

  const sendHtml = (res: ServerResponse, filePath: string) => {
    res.writeHead(200, { 'Content-Type': mimeTypes['.html'] });
    res.end(injectGatewayUrl(readFileSync(filePath, 'utf8')));
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (proxyToGateway(req, res, gateway, port)) return;

    let pathname: string;
    try {
      pathname = decodeURIComponent(req.url?.split('?')[0] || '/');
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    if (!pathname.includes('.')) pathname += '.html';

    // Never serve files outside the Studio directory
    const filePath = resolve(root, `.${pathname}`);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = filePath.slice(filePath.lastIndexOf('.'));
      if (ext === '.html') {
        sendHtml(res, filePath);
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
    } else {
      // SPA fallback
      const indexPath = join(root, 'index.html');
      if (existsSync(indexPath)) {
        sendHtml(res, indexPath);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    }
  });

  // Local only: the proxy adds the gateway token to requests
  server.listen(port, '127.0.0.1', () => {
    success(`Kernova Studio is running!`);
    console.log('');
    console.log(`  ◆ Local:    http://localhost:${port}`);
    console.log(`  ◆ Gateway:  ${gateway.url}`);
    console.log(`  ◆ Assets:   ${distDir}`);
    console.log('');
    console.log('  Press Ctrl+C to stop.');
  });

  process.on('SIGINT', () => { server.close(); process.exit(0); });
  process.on('SIGTERM', () => { server.close(); process.exit(0); });

  await new Promise(() => {});
}

/**
 * Generate a self-contained Studio HTML page.
 * This is the embedded fallback when no pre-built Next.js export is available.
 * It's a fully functional dashboard that connects directly to the Gateway API.
 */
function generateStudioHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kernova Studio</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: { extend: { colors: { kernova: { 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb' } } } }
    }
  </script>
  <style>
    body { background: #09090b; color: #fafafa; font-family: system-ui, -apple-system, sans-serif; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 3px; }
  </style>
</head>
<body class="antialiased">
  <div id="app" class="flex min-h-screen">
    <!-- Sidebar -->
    <aside class="w-56 h-screen bg-zinc-900 border-r border-zinc-800 flex flex-col fixed left-0 top-0">
      <div class="p-4 border-b border-zinc-800">
        <h1 class="text-lg font-bold text-white tracking-tight">
          <span class="text-blue-400">◆</span> Kernova Studio
        </h1>
        <p class="text-xs text-zinc-500 mt-0.5">Developer Dashboard</p>
      </div>
      <nav class="flex-1 overflow-y-auto py-2" id="nav"></nav>
      <div class="p-3 border-t border-zinc-800">
        <div class="flex items-center gap-2 text-xs text-zinc-500" id="connection-status">
          <span class="w-2 h-2 rounded-full bg-zinc-600"></span>
          Connecting...
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 ml-56 p-6 overflow-auto" id="content">
      <div class="text-center py-20 text-zinc-500">Loading...</div>
    </main>
  </div>

  <script>
    const API = '${PROXY_PREFIX}';
    const pages = [
      { id: 'dashboard', label: 'Dashboard', icon: '◈' },
      { id: 'agents', label: 'Agents', icon: '⬡' },
      { id: 'events', label: 'Events', icon: '⚡' },
      { id: 'memory', label: 'Memory', icon: '◎' },
      { id: 'metrics', label: 'Monitoring', icon: '◉' },
      { id: 'logs', label: 'Logs', icon: '☰' },
      { id: 'plugins', label: 'Plugins', icon: '⧉' },
      { id: 'permissions', label: 'Permissions', icon: '⛊' },
    ];
    let currentPage = 'dashboard';
    let connected = false;

    // API helper
    async function api(path, options) {
      try {
        const res = await fetch(API + path, { ...options, headers: { 'Content-Type': 'application/json', 'X-Kernova-Studio': '1' } });
        if (!res.ok) throw new Error(res.statusText);
        return await res.json();
      } catch (e) { return null; }
    }

    // Render navigation
    function renderNav() {
      const nav = document.getElementById('nav');
      nav.innerHTML = pages.map(p => 
        '<a href="#" onclick="navigate(\\'' + p.id + '\\'); return false;" class="flex items-center gap-2.5 px-4 py-2 mx-2 rounded-md text-sm transition-colors ' +
        (currentPage === p.id ? 'bg-blue-600/20 text-blue-300 font-medium' : 'text-zinc-400 hover:text-white hover:bg-zinc-800') + '">' +
        '<span class="text-base">' + p.icon + '</span>' + p.label + '</a>'
      ).join('');
    }

    // Navigation
    function navigate(page) {
      currentPage = page;
      renderNav();
      renderPage();
    }

    // Render pages
    async function renderPage() {
      const content = document.getElementById('content');
      switch (currentPage) {
        case 'dashboard': await renderDashboard(content); break;
        case 'agents': await renderAgents(content); break;
        case 'events': await renderEvents(content); break;
        case 'memory': await renderMemory(content); break;
        case 'metrics': await renderMetrics(content); break;
        case 'logs': await renderLogs(content); break;
        case 'plugins': await renderPlugins(content); break;
        case 'permissions': await renderPermissions(content); break;
      }
    }

    async function renderDashboard(el) {
      const health = await api('/health') || { status: 'offline', agents: 0, activeIntents: 0 };
      const metrics = await api('/v1/metrics') || { totalTokens: 0, totalRequests: 0, errorRate: 0, avgLatency: 0, activeAgents: 0, pendingTasks: 0, uptime: 0 };

      el.innerHTML = '<div class="space-y-6">' +
        '<div class="flex items-center justify-between"><div><h1 class="text-2xl font-bold text-white">Dashboard</h1><p class="text-sm text-zinc-500">Platform overview</p></div>' +
        '<div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full ' + (health.status === 'ok' ? 'bg-emerald-500' : 'bg-red-500') + '"></span><span class="text-sm text-zinc-400">' + esc(health.status || 'offline') + '</span></div></div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">' +
        statCard('Active Agents', metrics.activeAgents, '⬡') +
        statCard('Pending Tasks', metrics.pendingTasks, '⏳') +
        statCard('Total Requests', metrics.totalRequests.toLocaleString(), '↗') +
        statCard('Tokens Used', (metrics.totalTokens / 1000).toFixed(0) + 'k', '⚙') +
        statCard('Avg Latency', metrics.avgLatency + 'ms', '⚡') +
        statCard('Error Rate', (metrics.errorRate * 100).toFixed(1) + '%', '⚠') +
        statCard('Uptime', Math.floor(metrics.uptime / 3600) + 'h', '△') +
        statCard('Gateway', health.status === 'ok' ? 'Connected' : 'Offline', '◉') +
        '</div></div>';
    }

    async function renderAgents(el) {
      const data = await api('/v1/agents') || { agents: [] };
      el.innerHTML = '<div class="space-y-6"><h1 class="text-2xl font-bold text-white">Agents</h1>' +
        '<div class="border border-zinc-800 rounded-lg overflow-hidden"><table class="w-full text-sm"><thead><tr class="bg-zinc-900/50 border-b border-zinc-800">' +
        '<th class="text-left px-4 py-3 text-xs font-medium text-zinc-500">Name</th><th class="text-left px-4 py-3 text-xs font-medium text-zinc-500">Model</th><th class="text-left px-4 py-3 text-xs font-medium text-zinc-500">Capabilities</th><th class="text-left px-4 py-3 text-xs font-medium text-zinc-500">Status</th>' +
        '</tr></thead><tbody class="divide-y divide-zinc-800/50">' +
        (data.agents.length === 0 ? '<tr><td colspan="4" class="px-4 py-8 text-center text-zinc-600">No agents registered. Use kernel.agentRegistry.register() to add agents.</td></tr>' :
        data.agents.map(a => '<tr class="hover:bg-zinc-800/30"><td class="px-4 py-3 text-white font-medium">' + esc(a.name) + '</td><td class="px-4 py-3 text-zinc-400 font-mono text-xs">' + esc(a.model) + '</td><td class="px-4 py-3 text-zinc-500 text-xs">' + esc((a.capabilities||[]).join(', ')) + '</td><td class="px-4 py-3"><span class="text-emerald-400 text-xs">● active</span></td></tr>').join('')) +
        '</tbody></table></div></div>';
    }

    async function renderEvents(el) {
      const data = await api('/v1/events') || { events: [] };
      el.innerHTML = '<div class="space-y-6"><div class="flex items-center justify-between"><div><h1 class="text-2xl font-bold text-white">Events</h1><p class="text-sm text-zinc-500">Real-time event stream</p></div><span class="flex items-center gap-2 text-xs text-zinc-500"><span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>Live</span></div>' +
        '<div class="border border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-800/50">' +
        (data.events.length === 0 ? '<div class="px-4 py-8 text-center text-zinc-600">No events yet. Submit an intent to generate events.</div>' :
        data.events.slice(0, 30).map(e => '<div class="px-4 py-3 flex items-center gap-3 hover:bg-zinc-800/30"><span class="text-xs px-2 py-0.5 rounded ' + (e.severity === 'error' ? 'bg-red-500/20 text-red-400' : e.severity === 'warn' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400') + '">' + esc(e.severity) + '</span><span class="text-xs text-zinc-600 font-mono">' + esc(e.type) + '</span><span class="text-sm text-zinc-300 flex-1 truncate">' + esc(e.message) + '</span><span class="text-xs text-zinc-600">' + new Date(e.timestamp).toLocaleTimeString() + '</span></div>').join('')) +
        '</div></div>';
    }

    async function renderMemory(el) {
      el.innerHTML = '<div class="space-y-6"><h1 class="text-2xl font-bold text-white">Memory Explorer</h1><p class="text-sm text-zinc-500">Search agent memory across all layers</p>' +
        '<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4"><div class="flex gap-3"><input id="mem-query" type="text" placeholder="Semantic search..." class="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500" /><button onclick="searchMemory()" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md font-medium">Search</button></div></div>' +
        '<div id="mem-results" class="text-zinc-500 text-sm">Enter a query to search memory.</div></div>';
    }

    async function renderMetrics(el) {
      const m = await api('/v1/metrics') || { totalTokens: 0, totalRequests: 0, errorRate: 0, avgLatency: 0, uptime: 0, activeAgents: 0, pendingTasks: 0 };
      el.innerHTML = '<div class="space-y-6"><h1 class="text-2xl font-bold text-white">Monitoring</h1>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">' +
        statCard('Total Requests', m.totalRequests.toLocaleString(), '↗') +
        statCard('Token Usage', (m.totalTokens / 1000000).toFixed(2) + 'M', '⚙') +
        statCard('Error Rate', (m.errorRate * 100).toFixed(2) + '%', '⚠') +
        statCard('Avg Latency', m.avgLatency + 'ms', '⚡') +
        '</div></div>';
    }

    async function renderLogs(el) {
      const data = await api('/v1/logs') || { logs: [] };
      const levelColors = { debug: 'text-zinc-500', info: 'text-blue-400', warn: 'text-amber-400', error: 'text-red-400' };
      el.innerHTML = '<div class="space-y-6"><h1 class="text-2xl font-bold text-white">Logs & Traces</h1>' +
        '<div class="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden font-mono text-xs"><div class="p-3 border-b border-zinc-800 text-zinc-500">$ kernova logs --follow</div><div class="p-3 space-y-1 max-h-[600px] overflow-y-auto">' +
        (data.logs.length === 0 ? '<div class="text-zinc-600 py-4 text-center">No logs yet.</div>' :
        data.logs.map(l => '<div class="flex gap-3 py-1 px-2 hover:bg-zinc-900/50 rounded"><span class="text-zinc-600 w-20 flex-shrink-0">' + new Date(l.timestamp).toLocaleTimeString() + '</span><span class="' + (levelColors[l.level]||'text-zinc-500') + ' w-12 flex-shrink-0">' + esc(String(l.level).toUpperCase()) + '</span><span class="text-zinc-600 w-28 flex-shrink-0 truncate">[' + esc(l.source) + ']</span><span class="text-zinc-300 flex-1">' + esc(l.message) + '</span></div>').join('')) +
        '</div></div></div>';
    }

    async function renderPlugins(el) {
      const data = await api('/v1/plugins') || { plugins: [] };
      el.innerHTML = '<div class="space-y-6"><h1 class="text-2xl font-bold text-white">Plugins</h1>' +
        '<div class="border border-zinc-800 rounded-lg overflow-hidden"><table class="w-full text-sm"><thead><tr class="bg-zinc-900/50 border-b border-zinc-800"><th class="text-left px-4 py-3 text-xs font-medium text-zinc-500">Plugin</th><th class="text-left px-4 py-3 text-xs font-medium text-zinc-500">Version</th><th class="text-left px-4 py-3 text-xs font-medium text-zinc-500">Status</th></tr></thead><tbody class="divide-y divide-zinc-800/50">' +
        (data.plugins.length === 0 ? '<tr><td colspan="3" class="px-4 py-8 text-center text-zinc-600">No plugins installed.</td></tr>' :
        data.plugins.map(p => '<tr class="hover:bg-zinc-800/30"><td class="px-4 py-3"><span class="text-white font-medium">' + esc(p.name) + '</span><p class="text-xs text-zinc-500 mt-0.5">' + esc(p.description) + '</p></td><td class="px-4 py-3 font-mono text-xs text-zinc-400">' + esc(p.version) + '</td><td class="px-4 py-3"><span class="text-emerald-400 text-xs">● ' + esc(p.status) + '</span></td></tr>').join('')) +
        '</tbody></table></div></div>';
    }

    async function renderPermissions(el) {
      const data = await api('/v1/permissions/identities') || { identities: [] };
      el.innerHTML = '<div class="space-y-6"><h1 class="text-2xl font-bold text-white">Permissions</h1>' +
        '<div class="border border-zinc-800 rounded-lg overflow-hidden"><table class="w-full text-sm"><thead><tr class="bg-zinc-900/50 border-b border-zinc-800"><th class="text-left px-4 py-3 text-xs font-medium text-zinc-500">Identity</th><th class="text-left px-4 py-3 text-xs font-medium text-zinc-500">Type</th><th class="text-left px-4 py-3 text-xs font-medium text-zinc-500">Roles</th></tr></thead><tbody class="divide-y divide-zinc-800/50">' +
        (data.identities.length === 0 ? '<tr><td colspan="3" class="px-4 py-8 text-center text-zinc-600">No identities registered.</td></tr>' :
        data.identities.map(i => '<tr class="hover:bg-zinc-800/30"><td class="px-4 py-3 text-white font-medium">' + esc(i.name) + '</td><td class="px-4 py-3 text-zinc-400 text-xs">' + esc(i.type) + '</td><td class="px-4 py-3 text-zinc-500 text-xs">' + esc((i.roles||[]).join(', ')) + '</td></tr>').join('')) +
        '</tbody></table></div></div>';
    }

    // Helpers
    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    }

    function statCard(title, value, icon) {
      return '<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors"><div class="flex items-start justify-between"><div><p class="text-xs text-zinc-500 uppercase tracking-wide">' + title + '</p><p class="text-2xl font-semibold text-white mt-1">' + esc(value) + '</p></div><span class="text-2xl text-zinc-600">' + icon + '</span></div></div>';
    }

    async function searchMemory() {
      const query = document.getElementById('mem-query').value;
      if (!query) return;
      const data = await api('/v1/memory/search', { method: 'POST', body: JSON.stringify({ query }) });
      const results = data?.results || [];
      document.getElementById('mem-results').innerHTML = results.length === 0 ? '<p class="text-zinc-500">No results found.</p>' :
        '<div class="border border-zinc-800 rounded-lg divide-y divide-zinc-800/50">' + results.map(m => '<div class="px-4 py-3"><p class="text-white">' + esc(m.content) + '</p><div class="flex gap-4 mt-1 text-xs text-zinc-500"><span>Layer: ' + esc(m.layer) + '</span><span>Relevance: ' + (m.relevance * 100).toFixed(0) + '%</span><span>' + esc((m.tags||[]).join(', ')) + '</span></div></div>').join('') + '</div>';
    }

    // Health check & connection status
    async function checkConnection() {
      const health = await api('/health');
      const statusEl = document.getElementById('connection-status');
      if (health && health.status === 'ok') {
        connected = true;
        statusEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Gateway connected';
      } else {
        connected = false;
        statusEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500"></span> Gateway offline';
      }
    }

    // Init
    renderNav();
    renderPage();
    checkConnection();
    setInterval(checkConnection, 5000);
    // Auto-refresh events page
    setInterval(() => { if (currentPage === 'events' || currentPage === 'logs') renderPage(); }, 3000);
  </script>
</body>
</html>`;
}

interface StudioOptions {
  port?: number;
  gateway?: string;
  token?: string;
  help?: boolean;
}

function parseStudioArgs(args: string[]): StudioOptions {
  const options: StudioOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
      case '-p':
        options.port = parseInt(args[++i], 10);
        break;
      case '--gateway':
      case '-g':
        options.gateway = args[++i];
        break;
      case '--token':
      case '-t':
        options.token = args[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function printStudioHelp(): void {
  console.log(`
  Usage: kernova studio [options]

  Launch Kernova Studio — a visual developer dashboard for managing
  agents, inspecting events, searching memory, and monitoring the runtime.

  Studio connects to your running Kernova Gateway API to display real-time data.

  Options:
    -p, --port <number>     Port for Studio UI (default: 4200)
    -g, --gateway <url>     Gateway API URL (default: http://localhost:3000)
    -t, --token <token>     Gateway token (default: $KERNOVA_API_KEY)
    -h, --help              Show this help message

  Prerequisites:
    A running Gateway: 'kernova serve --port 3000', or kernel.gateway.start() in your app.

  Examples:
    KERNOVA_API_KEY=secret kernova serve --port 3000   # terminal 1
    KERNOVA_API_KEY=secret kernova studio              # terminal 2
    kernova studio --gateway https://staging.example.com --token $STAGING_TOKEN

  Studio listens on localhost only. Your browser talks to Studio, and Studio
  forwards API calls to the Gateway with the token, so the token never
  reaches the browser.
  `);
}
