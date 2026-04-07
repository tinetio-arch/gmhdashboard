const http = require('http');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3099;
const DOCS_DIR = path.join(process.env.HOME, 'gmhdashboard/docs');
const SCRIPTS_DIR = path.join(process.env.HOME, 'gmhdashboard/scripts');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /api/health-check
  if (url.pathname === '/api/health-check' && req.method === 'GET') {
    try {
      execSync(`bash ${SCRIPTS_DIR}/health-check.sh`, { timeout: 30000 });
      execSync(`bash ${SCRIPTS_DIR}/generate-status-report.sh`, { timeout: 30000 });
      const kpi = fs.readFileSync(path.join(DOCS_DIR, 'KPI_CHECK.md'), 'utf8');
      const status = fs.readFileSync(path.join(DOCS_DIR, 'LIVE_STATUS.md'), 'utf8');
      const tracker = fs.readFileSync(path.join(DOCS_DIR, 'PROJECT_TRACKER.md'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ kpi, status, tracker }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /api/sessions
  if (url.pathname === '/api/sessions' && req.method === 'GET') {
    try {
      const out = execSync('tmux list-sessions 2>/dev/null || echo ""', { timeout: 5000 }).toString();
      const sessions = out.trim().split('\n').filter(l => l.includes('claude')).map(l => {
        const name = l.split(':')[0];
        let rc_url = '';
        try {
          const pane = execSync(`tmux capture-pane -t ${name} -p 2>/dev/null`, { timeout: 3000 }).toString();
          const match = pane.match(/https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_]+/);
          if (match) rc_url = match[0];
        } catch(e) {}
        return { name, remote_control_url: rc_url, attached: l.includes('attached') };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/launch-task
  if (url.pathname === '/api/launch-task' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { task_id, user_input } = JSON.parse(body);
        if (!task_id) { res.writeHead(400); res.end(JSON.stringify({ error: 'task_id required' })); return; }
        const safeTaskId = task_id.replace(/[^a-z0-9-]/g, '');
        const safeInput = (user_input || '').replace(/'/g, "'\\''");
        exec(`bash ${SCRIPTS_DIR}/claude-task.sh '${safeTaskId}' '${safeInput}'`, { timeout: 45000 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message, stderr }));
            return;
          }
          try {
            const result = JSON.parse(stdout.trim());
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch(pe) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'launched', raw: stdout.trim() }));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // GET /api/kill-session
  if (url.pathname === '/api/kill-session' && req.method === 'GET') {
    const session = url.searchParams.get('session');
    if (!session || !session.startsWith('claude-task-')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid session name' }));
      return;
    }
    try {
      execSync(`tmux kill-session -t ${session} 2>/dev/null`, { timeout: 5000 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'killed', session }));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'not_found', session }));
    }
    return;
  }

  // Serve dashboard HTML
  if (url.pathname === '/' || url.pathname === '/command-center') {
    const htmlPath = path.join(DOCS_DIR, 'command-center.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(htmlPath));
    } else {
      res.writeHead(404);
      res.end('Dashboard not deployed yet');
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log(`Command Center API running on port ${PORT}`));
