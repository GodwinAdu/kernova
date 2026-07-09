/**
 * Nexus Studio UI
 * 
 * Self-contained HTML dashboard. No build step, no external dependencies.
 * Everything is inline — HTML, CSS, JavaScript.
 * 
 * Features:
 * - Real-time event stream (SSE)
 * - Intent submission
 * - Agent inspection
 * - Memory search
 * - System status
 */

export function getStudioHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nexus Studio</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #0f1117;
  --bg2: #1a1d27;
  --bg3: #252830;
  --border: #2e3140;
  --text: #e4e4e7;
  --text2: #a1a1aa;
  --accent: #6366f1;
  --accent2: #818cf8;
  --green: #22c55e;
  --red: #ef4444;
  --yellow: #eab308;
  --blue: #3b82f6;
  --font: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
}
body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; }
a { color: var(--accent2); text-decoration: none; }
button {
  background: var(--accent); color: white; border: none; padding: 8px 16px;
  border-radius: 6px; cursor: pointer; font-family: var(--font); font-size: 12px;
}
button:hover { background: var(--accent2); }
input, textarea {
  background: var(--bg3); border: 1px solid var(--border); color: var(--text);
  padding: 8px 12px; border-radius: 6px; font-family: var(--font); font-size: 12px; width: 100%;
}
textarea { resize: vertical; min-height: 60px; }

/* Layout */
.app { display: grid; grid-template-rows: 48px 1fr; height: 100vh; }
.header {
  background: var(--bg2); border-bottom: 1px solid var(--border);
  display: flex; align-items: center; padding: 0 20px; gap: 20px;
}
.header h1 { font-size: 14px; font-weight: 600; color: var(--accent2); }
.header .status { font-size: 11px; color: var(--green); }
.header .status.offline { color: var(--red); }
nav { display: flex; gap: 4px; }
nav button { background: transparent; color: var(--text2); font-size: 12px; padding: 6px 12px; }
nav button.active { background: var(--bg3); color: var(--text); }
.main { display: grid; grid-template-columns: 1fr 380px; overflow: hidden; }
.content { overflow-y: auto; padding: 20px; }
.sidebar { background: var(--bg2); border-left: 1px solid var(--border); overflow-y: auto; padding: 16px; }

/* Cards */
.card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
.card h3 { font-size: 12px; color: var(--text2); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
.card .value { font-size: 20px; font-weight: 600; }

/* Stats grid */
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }

/* Event stream */
.event-list { display: flex; flex-direction: column; gap: 4px; }
.event-item {
  padding: 8px 12px; border-radius: 6px; background: var(--bg3);
  display: grid; grid-template-columns: 90px 1fr auto; gap: 12px; align-items: center;
  font-size: 12px;
}
.event-item .time { color: var(--text2); font-size: 11px; }
.event-item .type { color: var(--accent2); }
.event-item .category { color: var(--text2); font-size: 10px; padding: 2px 6px; background: var(--bg); border-radius: 3px; }

/* Memory items */
.memory-item { padding: 12px; border-radius: 6px; background: var(--bg3); margin-bottom: 8px; }
.memory-item .layer { font-size: 10px; padding: 2px 6px; background: var(--accent); color: white; border-radius: 3px; display: inline-block; margin-bottom: 6px; }
.memory-item .content-text { color: var(--text); margin-bottom: 4px; }
.memory-item .meta { color: var(--text2); font-size: 11px; }

/* Agent items */
.agent-item { padding: 12px; border-radius: 6px; background: var(--bg3); margin-bottom: 8px; }
.agent-item .name { font-weight: 600; color: var(--accent2); margin-bottom: 4px; }
.agent-item .desc { color: var(--text2); font-size: 12px; }

/* Intent form */
.intent-form { display: flex; flex-direction: column; gap: 8px; }
.intent-result { margin-top: 12px; padding: 12px; background: var(--bg3); border-radius: 6px; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; }
.intent-result.success { border-left: 3px solid var(--green); }
.intent-result.error { border-left: 3px solid var(--red); }

/* Section header */
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.section-header h2 { font-size: 16px; font-weight: 600; }
</style>
</head>
<body>
<div class="app">
  <div class="header">
    <h1>◆ Nexus Studio</h1>
    <div class="status" id="status">connecting...</div>
    <nav>
      <button class="active" onclick="showTab('events')">Events</button>
      <button onclick="showTab('memory')">Memory</button>
      <button onclick="showTab('agents')">Agents</button>
    </nav>
  </div>
  <div class="main">
    <div class="content" id="content">
      <!-- Filled by JS -->
    </div>
    <div class="sidebar">
      <div class="card">
        <h3>Submit Intent</h3>
        <div class="intent-form">
          <textarea id="intentGoal" placeholder="What do you want to do?"></textarea>
          <button onclick="submitIntent()">Submit</button>
        </div>
        <div id="intentResult"></div>
      </div>
      <div class="card">
        <h3>System</h3>
        <div id="systemInfo">Loading...</div>
      </div>
    </div>
  </div>
</div>

<script>
const API = '';
let currentTab = 'events';
let events = [];
let eventSource = null;

// Tab management
function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  render();
}

// Render current view
function render() {
  const content = document.getElementById('content');
  switch (currentTab) {
    case 'events': renderEvents(content); break;
    case 'memory': renderMemory(content); break;
    case 'agents': renderAgents(content); break;
  }
}

// Events view
function renderEvents(el) {
  el.innerHTML = \`
    <div class="section-header">
      <h2>Events <span style="color:var(--text2);font-size:12px">(\${events.length})</span></h2>
      <button onclick="clearEvents()">Clear</button>
    </div>
    <div class="event-list" id="eventList">
      \${events.slice(0, 100).map(e => \`
        <div class="event-item">
          <span class="time">\${e.timestamp?.slice(11, 23) || ''}</span>
          <span class="type">\${e.eventType}</span>
          <span class="category">\${e.category}</span>
        </div>
      \`).join('')}
      \${events.length === 0 ? '<div style="color:var(--text2);padding:20px;text-align:center">Waiting for events...</div>' : ''}
    </div>
  \`;
}

function clearEvents() { events = []; render(); }

// Memory view
async function renderMemory(el) {
  el.innerHTML = \`
    <div class="section-header"><h2>Memory</h2></div>
    <div style="margin-bottom:16px">
      <input type="text" id="memorySearch" placeholder="Search memories..." onkeyup="if(event.key==='Enter')searchMemory()">
    </div>
    <div id="memoryResults">Loading...</div>
  \`;
  searchMemory();
}

async function searchMemory() {
  const q = document.getElementById('memorySearch')?.value || '';
  const params = q ? '?q=' + encodeURIComponent(q) : '?limit=20';
  try {
    const res = await fetch(API + '/api/memory' + params);
    const data = await res.json();
    const el = document.getElementById('memoryResults');
    if (!el) return;
    if (data.memories.length === 0) {
      el.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">No memories found</div>';
      return;
    }
    el.innerHTML = data.memories.map(m => \`
      <div class="memory-item">
        <span class="layer">\${m.layer}</span>
        <span class="layer" style="background:var(--bg);color:var(--text2)">\${m.memoryType}</span>
        <div class="content-text" style="margin-top:6px">\${escapeHtml(m.content)}</div>
        <div class="meta">relevance: \${m.relevance.toFixed(2)} | confidence: \${m.confidence.toFixed(2)} | accessed: \${m.accessCount}x</div>
      </div>
    \`).join('');
  } catch(e) { console.error(e); }
}

// Agents view
async function renderAgents(el) {
  el.innerHTML = '<div class="section-header"><h2>Agents</h2></div><div id="agentList">Loading...</div>';
  try {
    const res = await fetch(API + '/api/agents');
    const data = await res.json();
    document.getElementById('agentList').innerHTML = data.agents.length === 0
      ? '<div style="color:var(--text2);padding:20px;text-align:center">No agents registered</div>'
      : data.agents.map(a => \`
        <div class="agent-item">
          <div class="name">\${a.name}</div>
          <div class="desc">\${a.description}</div>
          <div class="meta" style="color:var(--text2);font-size:11px;margin-top:6px">
            Capabilities: \${a.capabilities.map(c => c.name).join(', ')}
          </div>
        </div>
      \`).join('');
  } catch(e) { console.error(e); }
}

// Submit intent
async function submitIntent() {
  const goal = document.getElementById('intentGoal').value.trim();
  if (!goal) return;

  const resultEl = document.getElementById('intentResult');
  resultEl.innerHTML = '<div class="intent-result" style="color:var(--text2)">Processing...</div>';

  try {
    const res = await fetch(API + '/api/intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal }),
    });
    const data = await res.json();
    const intent = data.intent;
    const success = intent.result?.success;
    resultEl.innerHTML = \`
      <div class="intent-result \${success ? 'success' : 'error'}">
        <strong>\${success ? '✓' : '✗'} \${intent.intentStatus}</strong> (\${intent.result?.durationMs || 0}ms)
        \\n\\n\${escapeHtml(intent.result?.summary || 'No result')}
      </div>
    \`;
  } catch(e) {
    resultEl.innerHTML = \`<div class="intent-result error">Error: \${e.message}</div>\`;
  }
}

// System info
async function loadStatus() {
  try {
    const res = await fetch(API + '/api/status');
    const data = await res.json();
    document.getElementById('status').textContent = 'running';
    document.getElementById('status').className = 'status';
    document.getElementById('systemInfo').innerHTML = \`
      <div style="display:grid;gap:6px;font-size:12px">
        <div><span style="color:var(--text2)">Env:</span> \${data.environment}</div>
        <div><span style="color:var(--text2)">Agents:</span> \${data.registeredAgents}</div>
        <div><span style="color:var(--text2)">Providers:</span> \${data.availableProviders?.join(', ') || 'none'}</div>
        <div><span style="color:var(--text2)">Events:</span> \${data.events?.totalEvents || 0}</div>
        <div><span style="color:var(--text2)">Memory:</span> \${Object.values(data.memory || {}).reduce((a,b) => a+b, 0)} entries</div>
        <div><span style="color:var(--text2)">Tokens:</span> \${data.modelUsage?.usage?.totalTokens || 0}</div>
      </div>
    \`;
  } catch(e) {
    document.getElementById('status').textContent = 'offline';
    document.getElementById('status').className = 'status offline';
  }
}

// SSE connection
function connectSSE() {
  eventSource = new EventSource(API + '/api/events/stream');
  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'connected') return;
      events.unshift(data);
      if (events.length > 200) events.pop();
      if (currentTab === 'events') render();
    } catch(err) {}
  };
  eventSource.onerror = () => {
    document.getElementById('status').textContent = 'reconnecting...';
    document.getElementById('status').className = 'status offline';
  };
}

// Load historical events
async function loadEvents() {
  try {
    const res = await fetch(API + '/api/events?limit=50&order=desc');
    const data = await res.json();
    events = data.events || [];
    render();
  } catch(e) {}
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Init
loadStatus();
loadEvents();
connectSSE();
setInterval(loadStatus, 5000);
render();
</script>
</body>
</html>`;
}
