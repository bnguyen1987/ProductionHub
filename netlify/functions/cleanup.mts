import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { checkAccess } from "../lib/access.mjs";

// Bi-weekly machine clean-up sign-offs. One blob per sign-off: "log/<ISO>-<rand>".
// Crew submits (status "Pending"), then a supervisor verifies (status "Verified").
const store = () => getStore({ name: "machine-cleanups", consistency: "strong" });

const s = (v: any, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const yn = (v: any) => (v === "Y" || v === "N" ? v : "");
const ymd = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
const hm = (v: any) => (/^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : "");

function cleanNew(b: any) {
  const tasks = Array.isArray(b.tasks) ? b.tasks.slice(0, 60).map((t: any) => ({
    task: s(t?.task, 200),
    status: t?.status === "done" || t?.status === "na" ? t.status : "",
  })) : [];
  return {
    machine: s(b.machine, 40),
    machineName: s(b.machineName, 80),
    date: ymd(b.date),
    shift: b.shift === "2nd" ? "2nd" : "1st",
    start: hm(b.start),
    end: hm(b.end),
    tasks,
    crew: Array.isArray(b.crew) ? b.crew.map((c: any) => s(c, 80)).filter(Boolean).slice(0, 8) : [],
    issuesFound: yn(b.issuesFound),
    taggedOut: yn(b.taggedOut),
    maintNotified: yn(b.maintNotified),
    repairNo: s(b.repairNo, 40),
    issues: s(b.issues, 2000),
    lang: b.lang === "es" ? "es" : "en",
  };
}

export default async (req: Request) => {
  const denied = checkAccess(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const blobs = store();

  try {
    // Planned clean-up schedule (whole year): [{ date, shift, machines: "all" | [ids], note }]
    if (url.searchParams.has("schedule")) {
      if (req.method === "GET") return Response.json((await blobs.get("schedule", { type: "json" })) || { plan: [], updatedAt: null });
      if (req.method === "PUT") {
        const raw = await req.text();
        if (raw.length > 300_000) return Response.json({ error: "Schedule too large" }, { status: 413 });
        const b = JSON.parse(raw);
        const plan = (Array.isArray(b.plan) ? b.plan : []).slice(0, 2000).map((p: any) => ({
          date: ymd(p?.date), shift: p?.shift === "2nd" ? "2nd" : "1st",
          machines: Array.isArray(p?.machines) ? p.machines.map((m: any) => s(m, 40)).filter(Boolean).slice(0, 40) : "all",
          note: s(p?.note, 200),
        })).filter((p: any) => p.date).sort((a: any, b: any) => a.date.localeCompare(b.date));
        const doc = { plan, updatedAt: new Date().toISOString() };
        await blobs.setJSON("schedule", doc);
        return Response.json(doc);
      }
      return new Response("Method not allowed", { status: 405 });
    }

    if (req.method === "GET") {
      const { blobs: list } = await blobs.list({ prefix: "log/" });
      const keys = list.map((b) => b.key).sort().reverse().slice(0, 600);
      const entries = (await Promise.all(keys.map(async (key) => {
        const v = await blobs.get(key, { type: "json" });
        return v ? { id: key, ...v } : null;
      }))).filter(Boolean);
      return Response.json({ entries });
    }

    if (req.method === "POST") {
      const raw = await req.text();
      if (raw.length > 100_000) return Response.json({ error: "Entry too large" }, { status: 413 });
      const e = cleanNew(JSON.parse(raw));
      if (!e.machine || !e.date || !e.tasks.length || !e.crew.length) {
        return Response.json({ error: "Machine, date, tasks and crew names are required" }, { status: 400 });
      }
      if (e.tasks.some((t: any) => !t.status)) return Response.json({ error: "Every task must be marked Done or N/A" }, { status: 400 });
      const savedAt = new Date().toISOString();
      const id = `log/${savedAt}-${Math.random().toString(36).slice(2, 8)}`;
      await blobs.setJSON(id, { ...e, status: "Pending", supervisor: "", supNote: "", verifiedAt: "", savedAt });
      return Response.json({ id, savedAt });
    }

    // Supervisor verification
    if (req.method === "PATCH") {
      const id = url.searchParams.get("id") || "";
      if (!id.startsWith("log/")) return Response.json({ error: "Bad id" }, { status: 400 });
      const cur: any = await blobs.get(id, { type: "json" });
      if (!cur) return Response.json({ error: "Clean-up not found" }, { status: 404 });
      const b = JSON.parse(await req.text());
      const supervisor = s(b.supervisor, 80);
      if (!supervisor) return Response.json({ error: "Supervisor name is required" }, { status: 400 });
      const supChecks = Array.isArray(b.supChecks) ? b.supChecks.map((x: any) => x === true) : [];
      if (supChecks.length !== (cur.tasks || []).length || supChecks.some((x: boolean) => !x)) {
        return Response.json({ error: "The supervisor must check every line" }, { status: 400 });
      }
      const next = { ...cur, status: "Verified", supervisor, supChecks, supNote: s(b.supNote, 1000), verifiedAt: new Date().toISOString() };
      await blobs.setJSON(id, next);
      return Response.json({ id, ...next });
    }

    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      if (!id.startsWith("log/")) return Response.json({ error: "Bad id" }, { status: 400 });
      await blobs.delete(id);
      return Response.json({ ok: true });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (e: any) {
    console.error("cleanup error", e?.message);
    return Response.json({ error: "Could not reach storage. Try again." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/cleanup" };
