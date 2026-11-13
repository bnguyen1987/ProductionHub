import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { checkAccess } from "../lib/access.mjs";
import { checkFiles, aiReady } from "../lib/ai-core.mts";

// Slow AI reads (print layouts) run as a background job so they are not cut off at the 26 s function limit.
// POST {task, files} → stores the files, starts ai-job-background, returns {id}. GET ?id= → {status, result | error}.
const store = () => getStore({ name: "ai-jobs", consistency: "strong" });
const okId = (id: string) => /^[a-z0-9]{8,40}$/.test(id);

export default async (req: Request) => {
  const denied = checkAccess(req);
  if (denied) return denied;
  const blobs = store();
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const id = url.searchParams.get("id") || "";
      if (!okId(id)) return Response.json({ error: "Bad id" }, { status: 400 });
      const job: any = await blobs.get("job/" + id, { type: "json" });
      if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
      if (job.status === "running" && Date.now() - job.at > 4 * 60 * 1000) return Response.json({ status: "error", error: "The AI took too long. Try again." });
      return Response.json(job);
    }
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
    const { error, files } = checkFiles(body);
    if (error) return Response.json({ error }, { status: 400 });
    if (!aiReady()) return Response.json({ error: "AI is not active on this site yet. Manual entry still works." }, { status: 503 });
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    await blobs.setJSON("in/" + id, { task: body.task, files });
    await blobs.setJSON("job/" + id, { status: "running", at: Date.now() });
    const r = await fetch(new URL("/.netlify/functions/ai-job-background", url.origin), {
      method: "POST", headers: { "content-type": "application/json", "x-access-code": req.headers.get("x-access-code") || "" }, body: JSON.stringify({ id }),
    });
    if (r.status !== 202 && !r.ok) { console.error("aijob start failed", r.status); return Response.json({ error: "Could not start the AI. Try again." }, { status: 502 }); }
    return Response.json({ id });
  } catch (e: any) {
    console.error("aijob error", e?.message);
    return Response.json({ error: "Could not reach storage. Try again." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/aijob" };
