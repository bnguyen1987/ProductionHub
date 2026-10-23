import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { checkAccess } from "../lib/access.mjs";

// Machine Specs tab: extra spec lines and notes added on the site (one blob per machine: "m/<id>").
// The core numbers (sheet sizes, colors, rule, speed) come from the spec sheets in public/js/ordercalc.js.
const store = () => getStore({ name: "machine-specs", consistency: "strong" });
const s = (v: any, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const okId = (id: string) => /^[A-Za-z0-9_-]{1,20}$/.test(id);

export default async (req: Request) => {
  const denied = checkAccess(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const blobs = store();
  try {
    if (req.method === "GET") {
      const { blobs: list } = await blobs.list({ prefix: "m/" });
      const machines: Record<string, any> = {};
      await Promise.all(list.map(async (b) => { const v = await blobs.get(b.key, { type: "json" }); if (v) machines[b.key.slice(2)] = v; }));
      return Response.json({ machines });
    }
    if (req.method === "PUT") {
      const id = url.searchParams.get("id") || "";
      if (!okId(id)) return Response.json({ error: "Bad machine id" }, { status: 400 });
      const raw = await req.text();
      if (raw.length > 50_000) return Response.json({ error: "Too much text" }, { status: 413 });
      const b = JSON.parse(raw);
      const updatedBy = s(b.updatedBy, 80);
      if (!updatedBy) return Response.json({ error: "Your name is required" }, { status: 400 });
      const extra = (Array.isArray(b.extra) ? b.extra : []).slice(0, 60)
        .map((r: any) => ({ label: s(r?.label, 80), value: s(r?.value, 300) }))
        .filter((r: any) => r.label || r.value);
      const doc = { extra, notes: s(b.notes, 3000), updatedBy, updatedAt: new Date().toISOString() };
      await blobs.setJSON("m/" + id, doc);
      return Response.json(doc);
    }
    return new Response("Method not allowed", { status: 405 });
  } catch (e: any) {
    console.error("specs error", e?.message);
    return Response.json({ error: "Could not reach storage. Try again." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/specs" };
