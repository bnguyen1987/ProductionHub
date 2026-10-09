import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { checkAccess } from "../lib/access.mjs";

// One blob per handoff entry, keyed "entry/<ISO time>-<random>" so keys sort by time.
const store = () => getStore({ name: "shift-handoffs", consistency: "strong" });

const MAX_LEN = 200_000;

function clean(entry: any) {
  const s = (v: any, n = 2000) => (typeof v === "string" ? v.slice(0, n) : "");
  const arr = (v: any, n = 40) => (Array.isArray(v) ? v.slice(0, n) : []);
  return {
    date: s(entry.date, 20),
    shift: s(entry.shift, 20),
    supervisor: s(entry.supervisor, 80),
    machines: arr(entry.machines, 20).map((m: any) => ({ machine: s(m?.machine, 80), status: s(m?.status, 20), note: s(m?.note, 500) })),
    jobs: arr(entry.jobs).map((j: any) => ({ machine: s(j?.machine, 80), job: s(j?.job, 60), customer: s(j?.customer, 120), done: s(j?.done, 30), left: s(j?.left, 30), note: s(j?.note, 500) })),
    quality: s(entry.quality, 4000),
    safety: s(entry.safety, 4000),
    maintenance: arr(entry.maintenance).map((m: any) => ({ machine: s(m?.machine, 80), issue: s(m?.issue, 800), priority: s(m?.priority, 20) })),
    general: s(entry.general, 4000),
  };
}

export default async (req: Request) => {
  const denied = checkAccess(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const blobs = store();

  try {
    if (req.method === "GET") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "40", 10) || 40, 200);
      const { blobs: list } = await blobs.list({ prefix: "entry/" });
      const keys = list.map((b) => b.key).sort().reverse().slice(0, limit);
      const entries = (await Promise.all(keys.map(async (key) => {
        const v = await blobs.get(key, { type: "json" });
        return v ? { id: key, ...v } : null;
      }))).filter(Boolean);
      return Response.json({ entries });
    }

    if (req.method === "POST") {
      const raw = await req.text();
      if (raw.length > MAX_LEN) return Response.json({ error: "Entry too large" }, { status: 413 });
      const entry = clean(JSON.parse(raw));
      if (!entry.date || !entry.shift || !entry.supervisor) {
        return Response.json({ error: "Date, shift and supervisor are required" }, { status: 400 });
      }
      const savedAt = new Date().toISOString();
      const key = `entry/${savedAt}-${Math.random().toString(36).slice(2, 8)}`;
      await blobs.setJSON(key, { ...entry, savedAt });
      return Response.json({ id: key, savedAt });
    }

    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      if (!id.startsWith("entry/")) return Response.json({ error: "Bad id" }, { status: 400 });
      await blobs.delete(id);
      return Response.json({ ok: true });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (e: any) {
    console.error("handoff error", e?.message);
    return Response.json({ error: "Could not reach storage. Try again." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/handoff" };
