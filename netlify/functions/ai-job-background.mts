import { getStore } from "@netlify/blobs";
import { checkAccess } from "../lib/access.mjs";
import { runAi } from "../lib/ai-core.mts";

// Background function (name ends in -background): runs up to 15 minutes. Started by /api/aijob.
export default async (req: Request) => {
  if (checkAccess(req)) return;
  const blobs = getStore({ name: "ai-jobs", consistency: "strong" });
  let id = "";
  try { id = String((await req.json())?.id || ""); } catch {}
  if (!/^[a-z0-9]{8,40}$/.test(id)) return;
  const input: any = await blobs.get("in/" + id, { type: "json" });
  if (!input) { await blobs.setJSON("job/" + id, { status: "error", error: "Upload was lost. Try again." }); return; }
  const r = await runAi(input.task, input.files);
  await blobs.setJSON("job/" + id, r.status === 200 ? { status: "done", result: r.body.result } : { status: "error", error: r.body.error });
  await blobs.delete("in/" + id);
};
