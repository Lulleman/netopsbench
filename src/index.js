const ALLOWED = {
  tool_open: new Set(["subnet", "explorer", "optics", "config", "mtu", "dashboard"]),
  tool_use: new Set(["subnet", "explorer", "optics", "config", "mtu"]),
  config_generated: new Set(["config"]),
  copy_result: new Set(["subnet", "explorer"])
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/event" && request.method === "POST") {
      try {
        const body = await request.json();
        const event = typeof body.event === "string" ? body.event : "";
        const tool = typeof body.tool === "string" ? body.tool : "";

        if (!ALLOWED[event] || !ALLOWED[event].has(tool)) {
          return json({ ok: false }, 400);
        }

        env.NETOPS_EVENTS.writeDataPoint({
          blobs: [event, tool],
          doubles: [1],
          indexes: [event]
        });

        return new Response(null, { status: 204 });
      } catch {
        return json({ ok: false }, 400);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
