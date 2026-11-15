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
  // Housekeeping: job ids start with the time they were made (base 36). Remove records and uploads older than a day.
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const prefix of ["job/", "in/"]) {
      const { blobs: list } = await blobs.list({ prefix });
      for (const b of list.slice(0, 200)) {
        const made = parseInt(b.key.slice(prefix.length, prefix.length + 8), 36);
        if (isFinite(made) && made < cutoff) await blobs.delete(b.key);
      }
    }
  } catch (e: any) { console.error("ai-jobs cleanup", e?.message); }
};
