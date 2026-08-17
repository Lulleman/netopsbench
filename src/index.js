const ALLOWED = {
  session_start: new Set(["session"]),
  tool_open: new Set(["subnet", "explorer", "optics", "config", "mtu", "dashboard"]),
  tool_use: new Set(["subnet", "explorer", "optics", "config", "mtu"]),
  config_generated: new Set(["config"]),
  copy_result: new Set(["subnet", "explorer"])
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

async function query(env, sql) {
  const api = `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`;
  const r = await fetch(api, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.ANALYTICS_READ_TOKEN}`,
      "Content-Type": "text/plain"
    },
    body: sql
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function adminOk(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.ADMIN_PASSWORD}`;
}

const ADMIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NetOpsBench Analytics</title>
<style>
body{margin:0;background:#0b0f14;color:#eef3f8;font-family:Inter,system-ui,sans-serif}
.wrap{max-width:1100px;margin:auto;padding:32px}.brand{color:#62a8ff;font-size:11px;font-weight:900;letter-spacing:.16em}
h1{margin:8px 0 6px;font-size:30px}.muted{color:#91a0b2}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:24px}
.card{background:#121821;border:1px solid #263342;border-radius:14px;padding:20px}.k{color:#91a0b2;font-size:11px;text-transform:uppercase;letter-spacing:.08em}.v{font-size:30px;font-weight:800;margin-top:8px}
.section{margin-top:18px}.row{display:grid;grid-template-columns:1fr 90px;gap:12px;padding:11px 0;border-bottom:1px solid #202b38}.bar{height:7px;background:#1b2632;border-radius:8px;overflow:hidden;margin-top:7px}.fill{height:100%;background:#62a8ff}
button{background:#62a8ff;color:#07101a;border:0;border-radius:8px;padding:9px 13px;font-weight:800;cursor:pointer}.top{display:flex;justify-content:space-between;align-items:end}
input{background:#0f151d;border:1px solid #334456;color:#eef3f8;border-radius:8px;padding:10px;width:260px}
#login{position:fixed;inset:0;background:#0b0f14;display:grid;place-items:center}.login{background:#121821;border:1px solid #263342;border-radius:14px;padding:28px;width:min(90%,360px)}
.err{color:#ff7d7d;margin-top:10px}
@media(max-width:700px){.grid{grid-template-columns:1fr}.wrap{padding:18px}}
</style></head>
<body>
<div id="login"><div class="login"><div class="brand">NETOPSBENCH</div><h2>Analytics</h2><p class="muted">Private dashboard.</p><input id="pw" type="password" placeholder="Admin password"><button id="go" style="margin-top:10px">Open dashboard</button><div id="err" class="err"></div></div></div>
<div class="wrap"><div class="top"><div><div class="brand">NETOPSBENCH / ANALYTICS</div><h1>Product dashboard</h1><div class="muted">Custom usage from Workers Analytics Engine</div></div><button id="refresh">Refresh</button></div>
<div class="grid"><div class="card"><div class="k">Sessions</div><div class="v" id="sessions">—</div></div><div class="card"><div class="k">Tool uses</div><div class="v" id="uses">—</div></div><div class="card"><div class="k">Configs generated</div><div class="v" id="configs">—</div></div></div>
<div class="section card"><h2>Most used tools</h2><div id="tools" class="muted">Loading…</div></div>
<div class="section card"><h2>Event breakdown</h2><div id="events" class="muted">Loading…</div></div>
<div class="section card"><h2>Activity — last 7 days</h2><div id="activity" class="muted">Loading…</div></div>
</div>
<script>
let token='';
const fmt=n=>Number(n||0).toLocaleString();
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function load(){
  const r=await fetch('/api/admin/dashboard',{headers:{Authorization:'Bearer '+token}});
  if(r.status===401) throw new Error('Wrong password');
  if(!r.ok) throw new Error('Dashboard query failed');
  const d=await r.json();
  document.getElementById('sessions').textContent=fmt(d.sessions);
  document.getElementById('uses').textContent=fmt(d.toolUses);
  document.getElementById('configs').textContent=fmt(d.configs);
  const max=Math.max(1,...d.tools.map(x=>Number(x.uses)));
  document.getElementById('tools').innerHTML=d.tools.length?d.tools.map(x=>'<div class="row"><div>'+esc(x.tool)+'<div class="bar"><div class="fill" style="width:'+Math.round(Number(x.uses)/max*100)+'%"></div></div></div><b>'+fmt(x.uses)+'</b></div>').join(''):'No data yet';
  document.getElementById('events').innerHTML=d.events.length?d.events.map(x=>'<div class="row"><div>'+esc(x.event)+' / '+esc(x.tool)+'</div><b>'+fmt(x.count)+'</b></div>').join(''):'No data yet';
  document.getElementById('activity').innerHTML=d.activity.length?d.activity.map(x=>'<div class="row"><div>'+esc(x.hour)+'</div><b>'+fmt(x.uses)+'</b></div>').join(''):'No data yet';
}
document.getElementById('go').onclick=async()=>{token=document.getElementById('pw').value;try{await load();document.getElementById('login').style.display='none';}catch(e){document.getElementById('err').textContent=e.message;}};
document.getElementById('refresh').onclick=()=>load().catch(e=>alert(e.message));
</script></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/event" && request.method === "POST") {
      try {
        const body = await request.json();
        const event = typeof body.event === "string" ? body.event : "";
        const tool = typeof body.tool === "string" ? body.tool : "";
        const sid = typeof body.sid === "string" ? body.sid.slice(0, 80) : "";

        if (!ALLOWED[event] || !ALLOWED[event].has(tool) || !sid) return json({ ok: false }, 400);

        const index = event === "session_start" ? `session:${sid}` : `${event}:${tool}`;
        env.NETOPS_EVENTS.writeDataPoint({
          blobs: [event, tool, sid],
          doubles: [1],
          indexes: [index]
        });
        return new Response(null, { status: 204 });
      } catch {
        return json({ ok: false }, 400);
      }
    }

    if (url.pathname === "/admin") {
      return new Response(ADMIN_HTML, {headers: {"content-type":"text/html;charset=UTF-8","cache-control":"no-store"}});
    }

    if (url.pathname === "/api/admin/dashboard") {
      if (!adminOk(request, env)) return json({error:"unauthorized"},401,{"www-authenticate":"Bearer"});
      if (!env.ACCOUNT_ID || !env.ANALYTICS_READ_TOKEN || !env.ADMIN_PASSWORD) return json({error:"Admin analytics is not configured."},500);

      try {
        const [sessions, uses, configs, tools, events, activity] = await Promise.all([
          query(env, `SELECT count(DISTINCT blob3) AS sessions FROM netopsbench_events WHERE blob1 = 'session_start' AND timestamp > NOW() - INTERVAL '7' DAY`),
          query(env, `SELECT SUM(_sample_interval) AS uses FROM netopsbench_events WHERE blob1 = 'tool_use' AND timestamp > NOW() - INTERVAL '7' DAY`),
          query(env, `SELECT SUM(_sample_interval) AS configs FROM netopsbench_events WHERE blob1 = 'config_generated' AND timestamp > NOW() - INTERVAL '7' DAY`),
          query(env, `SELECT blob2 AS tool, SUM(_sample_interval) AS uses FROM netopsbench_events WHERE blob1 IN ('tool_use','config_generated') AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY tool ORDER BY uses DESC LIMIT 10`),
          query(env, `SELECT blob1 AS event, blob2 AS tool, SUM(_sample_interval) AS count FROM netopsbench_events WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY event, tool ORDER BY count DESC LIMIT 20`),
          query(env, `SELECT toStartOfDay(timestamp) AS hour, SUM(_sample_interval) AS uses FROM netopsbench_events WHERE blob1 IN ('tool_use','config_generated') AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY hour ORDER BY hour ASC`)
        ]);
        const rows = x => x.data || [];
        return json({
          sessions: rows(sessions)[0]?.sessions || 0,
          toolUses: rows(uses)[0]?.uses || 0,
          configs: rows(configs)[0]?.configs || 0,
          tools: rows(tools),
          events: rows(events),
          activity: rows(activity)
        });
      } catch (e) {
        console.error(e);
        return json({error:"Analytics query failed"},500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
