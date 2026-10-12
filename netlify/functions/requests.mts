import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { checkAccess } from "../lib/access.mjs";

// Change requests from the floor. One blob per request ("req/<ISO>-<rand>"),
// photo stored separately ("photo/<same id>") so the list stays light.
const store = () => getStore({ name: "change-requests", consistency: "strong" });

const STATUSES = ["New", "Approved", "Rejected", "Done"];
const MAX_LEN = 3_000_000; // photo is a downscaled JPEG (base64), usually well under 1 MB

const s = (v: any, n = 2000) => (typeof v === "string" ? v.trim().slice(0, n) : "");

function cleanNew(b: any) {
  return {
    name: s(b.name, 80),
    shift: s(b.shift, 20),
    customer: s(b.customer, 120),
    spec: s(b.spec, 60),
    order: s(b.order, 60),
    machine: s(b.machine, 80),
    type: s(b.type, 60),
    current: s(b.current, 1000),
    change: s(b.change, 2000),
    reason: s(b.reason, 2000),
    toolNo: s(b.toolNo, 60),
    toolAction: ["Repair", "Replace", "Not sure"].includes(b.toolAction) ? b.toolAction : "",
    lang: b.lang === "es" ? "es" : "en",
    nextRun: /^\d{4}-\d{2}-\d{2}$/.test(String(b.nextRun || "")) ? String(b.nextRun) : "",
  };
}

export default async (req: Request) => {
  const denied = checkAccess(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const blobs = store();

  try {
    if (req.method === "GET") {
      const photo = url.searchParams.get("photo");
      if (photo) {
        if (!photo.startsWith("req/")) return Response.json({ error: "Bad id" }, { status: 400 });
        const p = await blobs.get("photo/" + photo, { type: "json" });
        return p ? Response.json(p) : Response.json({ error: "No photo" }, { status: 404 });
      }
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 500);
      const { blobs: list } = await blobs.list({ prefix: "req/" });
      const keys = list.map((b) => b.key).sort().reverse().slice(0, limit);
      const requests = (await Promise.all(keys.map(async (key) => {
        const v = await blobs.get(key, { type: "json" });
        return v ? { id: key, ...v } : null;
      }))).filter(Boolean);
      return Response.json({ requests });
    }

    if (req.method === "POST") {
      const raw = await req.text();
      if (raw.length > MAX_LEN) return Response.json({ error: "Photo is too large. Try again without it." }, { status: 413 });
      const body = JSON.parse(raw);
      const r = cleanNew(body);
      if (!r.name || !r.customer || !r.spec || !r.change) {
        return Response.json({ error: "Name, customer, spec # and the change are required" }, { status: 400 });
      }
      const savedAt = new Date().toISOString();
      const id = `req/${savedAt}-${Math.random().toString(36).slice(2, 8)}`;
      const photo = body.photo && typeof body.photo.data === "string" && body.photo.mediaType === "image/jpeg" ? body.photo.data : "";
      if (photo) await blobs.setJSON("photo/" + id, { data: photo, mediaType: "image/jpeg" });
      await blobs.setJSON(id, { ...r, hasPhoto: !!photo, status: "New", reviewNote: "", reviewedBy: "", reviewedAt: "", savedAt });
      return Response.json({ id, savedAt });
    }

    if (req.method === "PATCH") {
      const id = url.searchParams.get("id") || "";
      if (!id.startsWith("req/")) return Response.json({ error: "Bad id" }, { status: 400 });
      const cur: any = await blobs.get(id, { type: "json" });
      if (!cur) return Response.json({ error: "Request not found" }, { status: 404 });
      const b = JSON.parse(await req.text());
      const status = STATUSES.includes(b.status) ? b.status : cur.status;
      const next = { ...cur, status, reviewNote: s(b.reviewNote, 2000), reviewedBy: s(b.reviewedBy, 80), reviewedAt: new Date().toISOString() };
      await blobs.setJSON(id, next);
      return Response.json({ id, ...next });
    }

    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      if (!id.startsWith("req/")) return Response.json({ error: "Bad id" }, { status: 400 });
      await blobs.delete(id);
      await blobs.delete("photo/" + id);
      return Response.json({ ok: true });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (e: any) {
    console.error("requests error", e?.message);
    return Response.json({ error: "Could not reach storage. Try again." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/requests" };
