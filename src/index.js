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
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
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
  if (!r.ok) throw new Error(`Analytics API ${r.status}: ${await r.text()}`);
  return r.json();
}

async function adminSignature(env) {
  const data = new TextEncoder().encode("netopsbench-admin");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ADMIN_PASSWORD),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function adminOk(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)nb_admin=([^;]+)/);
  if (!m) return false;
  const expected = await adminSignature(env);
  return m[1] === expected;
}

const ADMIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NetOpsBench Analytics</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0b0f14;color:#eef3f8;font-family:Inter,system-ui,-apple-system,sans-serif}
.wrap{max-width:1120px;margin:auto;padding:28px 20px 50px}.brand{color:#62a8ff;font-size:10px;font-weight:900;letter-spacing:.16em}
h1{margin:7px 0 4px;font-size:30px}.muted{color:#91a0b2}.top{display:flex;justify-content:space-between;gap:20px;align-items:end}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:24px}
.card{background:#121821;border:1px solid #263342;border-radius:14px;padding:20px}.k{color:#91a0b2;font-size:10px;text-transform:uppercase;letter-spacing:.08em}.v{font-size:30px;font-weight:800;margin-top:8px}
.section{margin-top:16px}.row{display:grid;grid-template-columns:1fr 90px;gap:12px;padding:11px 0;border-bottom:1px solid #202b38;align-items:center}.row:last-child{border-bottom:0}
.bar{height:7px;background:#1b2632;border-radius:8px;overflow:hidden;margin-top:7px}.fill{height:100%;background:#62a8ff;border-radius:8px}
button{background:#62a8ff;color:#07101a;border:0;border-radius:8px;padding:9px 13px;font-weight:800;cursor:pointer}
button.secondary{background:#1a2531;color:#dce7f2;border:1px solid #334456}
input{background:#0f151d;border:1px solid #334456;color:#eef3f8;border-radius:8px;padding:10px;width:100%}
#login{position:fixed;inset:0;background:#0b0f14;display:grid;place-items:center;z-index:10}.login{background:#121821;border:1px solid #263342;border-radius:14px;padding:28px;width:min(90%,380px)}
.err{color:#ff7d7d;margin-top:10px;font-size:13px}
.statnote{font-size:11px;color:#718095;margin-top:5px}
svg{width:100%;height:180px;display:block}.axis{color:#718095;font-size:10px}
@media(max-width:700px){.grid{grid-template-columns:1fr}.top{align-items:start;flex-direction:column}.wrap{padding:18px}.row{grid-template-columns:1fr 70px}}
</style></head>
<body>
<div id="login"><div class="login"><div class="brand">NETOPSBENCH / PRIVATE</div><h2>Analytics</h2><p class="muted">Private product dashboard.</p><input id="pw" type="password" placeholder="Admin password" autocomplete="current-password"><button id="go" style="margin-top:10px;width:100%">Open dashboard</button><div id="err" class="err"></div></div></div>
<div class="wrap"><div class="top"><div><div class="brand">NETOPSBENCH / ANALYTICS</div><h1>Product dashboard</h1><div class="muted">Custom usage from Workers Analytics Engine · last 7 days</div></div><button class="secondary" id="refresh">Refresh</button></div>
<div class="grid"><div class="card"><div class="k">Sessions</div><div class="v" id="sessions">—</div><div class="statnote">Unique sessions</div></div><div class="card"><div class="k">Tool uses</div><div class="v" id="uses">—</div><div class="statnote">Successful tool calculations</div></div><div class="card"><div class="k">Configs generated</div><div class="v" id="configs">—</div><div class="statnote">Config Generator</div></div></div>
<div class="section card"><h2>Most used tools</h2><div id="tools" class="muted">Loading…</div></div>
<div class="section card"><h2>Event breakdown</h2><div id="events" class="muted">Loading…</div></div>
<div class="section card"><h2>Activity</h2><div id="activity" class="muted">Loading…</div></div>
</div>
<script>
async function api(path,options={}){const r=await fetch(path,options);if(r.status===401)throw new Error('Unauthorized');if(!r.ok)throw new Error('Request failed');return r.json();}
const fmt=n=>Number(n||0).toLocaleString();
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function drawActivity(rows){
  const el=document.getElementById('activity');
  if(!rows.length){el.textContent='No data yet';return}
  const vals=rows.map(x=>Number(x.uses)||0), max=Math.max(1,...vals), w=900,h=150,p=12;
  const points=vals.map((v,i)=>{const x=p+(i/(Math.max(1,vals.length-1)))*(w-2*p);const y=h-p-(v/max)*(h-2*p);return [x,y]});
  const poly=points.map(p=>p.join(',')).join(' ');
  el.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none"><polyline fill="none" stroke="#62a8ff" stroke-width="3" points="'+poly+'"></polyline></svg>'+
    '<div class="muted" style="display:flex;justify-content:space-between"><span>'+esc(rows[0].day)+'</span><span>'+esc(rows[rows.length-1].day)+'</span></div>';
}
async function load(){
  const d=await api('/api/admin/dashboard');
  document.getElementById('sessions').textContent=fmt(d.sessions);
  document.getElementById('uses').textContent=fmt(d.toolUses);
  document.getElementById('configs').textContent=fmt(d.configs);
  const max=Math.max(1,...d.tools.map(x=>Number(x.uses)));
  document.getElementById('tools').innerHTML=d.tools.length?d.tools.map(x=>'<div class="row"><div>'+esc(x.tool)+'<div class="bar"><div class="fill" style="width:'+Math.round(Number(x.uses)/max*100)+'%"></div></div></div><b>'+fmt(x.uses)+'</b></div>').join(''):'No data yet';
  document.getElementById('events').innerHTML=d.events.length?d.events.map(x=>'<div class="row"><div>'+esc(x.event)+' / '+esc(x.tool)+'</div><b>'+fmt(x.count)+'</b></div>').join(''):'No data yet';
  drawActivity(d.activity);
}
document.getElementById('go').onclick=async()=>{
  const password=document.getElementById('pw').value;
  try{
    const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
    if(!r.ok)throw new Error('Wrong password');
    await load();document.getElementById('login').style.display='none';
  }catch(e){document.getElementById('err').textContent=e.message;}
};
document.getElementById('pw').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('go').click()});
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
        if (!ALLOWED[event] || !ALLOWED[event].has(tool) || !sid) return json({ok:false},400);

        // Session IDs are random browser-generated identifiers. They are used only
        // to estimate unique sessions; no calculator input is recorded.
        const index = event === "session_start" ? `session:${sid}` : `${event}:${tool}`;
        env.NETOPS_EVENTS.writeDataPoint({
          blobs: [event, tool, sid],
          doubles: [1],
          indexes: [index]
        });
        return new Response(null,{status:204});
      } catch {
        return json({ok:false},400);
      }
    }

    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      try {
        const body = await request.json();
        if (typeof body.password !== "string" || body.password !== env.ADMIN_PASSWORD) {
          return json({error:"unauthorized"},401);
        }
        const sig = await adminSignature(env);
        return json({ok:true},200,{
          "Set-Cookie": `nb_admin=${sig}; Max-Age=28800; Path=/; Secure; HttpOnly; SameSite=Strict`
        });
      } catch {
        return json({error:"unauthorized"},401);
      }
    }

    if (url.pathname === "/admin") {
      return new Response(ADMIN_HTML,{headers:{"content-type":"text/html;charset=UTF-8","cache-control":"no-store"}});
    }

    if (url.pathname === "/api/admin/dashboard") {
      if (!await adminOk(request,env)) return json({error:"unauthorized"},401,{"www-authenticate":"Bearer"});
      if (!env.ACCOUNT_ID || !env.ANALYTICS_READ_TOKEN || !env.ADMIN_PASSWORD) return json({error:"Admin analytics is not configured."},500);

      try {
        const [sessions,uses,configs,tools,events,activity] = await Promise.all([
          query(env,`SELECT count(DISTINCT blob3) AS sessions FROM netopsbench_events WHERE blob1 = 'session_start' AND timestamp > NOW() - INTERVAL '7' DAY`),
          query(env,`SELECT SUM(_sample_interval) AS uses FROM netopsbench_events WHERE blob1 = 'tool_use' AND timestamp > NOW() - INTERVAL '7' DAY`),
          query(env,`SELECT SUM(_sample_interval) AS configs FROM netopsbench_events WHERE blob1 = 'config_generated' AND timestamp > NOW() - INTERVAL '7' DAY`),
          query(env,`SELECT blob2 AS tool, SUM(_sample_interval) AS uses FROM netopsbench_events WHERE blob1 IN ('tool_use','config_generated') AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY tool ORDER BY uses DESC LIMIT 10`),
          query(env,`SELECT blob1 AS event, blob2 AS tool, SUM(_sample_interval) AS count FROM netopsbench_events WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY event, tool ORDER BY count DESC LIMIT 20`),
          query(env,`SELECT toStartOfDay(timestamp) AS day, SUM(_sample_interval) AS uses FROM netopsbench_events WHERE blob1 IN ('tool_use','config_generated') AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY day ORDER BY day ASC`)
        ]);
        const rows=x=>x.data||[];
        return json({
          sessions: rows(sessions)[0]?.sessions||0,
          toolUses: rows(uses)[0]?.uses||0,
          configs: rows(configs)[0]?.configs||0,
          tools: rows(tools),
          events: rows(events),
          activity: rows(activity)
        });
      } catch(e) {
        console.error(e);
        return json({error:"Analytics query failed"},500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
