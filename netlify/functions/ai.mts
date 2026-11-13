import type { Config } from "@netlify/functions";
import { checkAccess } from "../lib/access.mjs";
import { checkFiles, aiReady, runAi } from "../lib/ai-core.mts";

// Quick AI reads (ink photo, quote, die line). Print layouts are slower and go through /api/aijob instead.
export default async (req: Request) => {
  const denied = checkAccess(req);
  if (denied) return denied;
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  const { error, files } = checkFiles(body);
  if (error) return Response.json({ error }, { status: 400 });
  if (!aiReady()) return Response.json({ error: "AI is not active on this site yet. Manual entry still works." }, { status: 503 });
  const r = await runAi(body.task, files!);
  return Response.json(r.body, { status: r.status });
};

export const config: Config = { path: "/api/ai" };
