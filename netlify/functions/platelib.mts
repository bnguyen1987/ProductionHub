import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { checkAccess } from "../lib/access.mjs";

// Customer plate library for the Print Layouts tab: a plate (logo picture or copy, size, turn) saved
// under a customer's name, so the next spec for that customer can reuse it. One blob per plate ("p/<id>").
// GET ?customer= → that customer's plates (GET with no customer → every plate), PUT ?id= → save, DELETE ?id= → remove.
const store = () => getStore({ name: "plate-library", consistency: "strong" });
const s = (v: any, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const okId = (id: string) => /^[A-Za-z0-9_-]{4,40}$/.test(id);
const okImg = (v: any) => typeof v === "string" && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 400_000;
const norm = (c: string) => c.replace(/\s+/g, " ").trim().toLowerCase();

function clean(b: any) {
  return {
    customer: s(b.customer, 120), name: s(b.name, 80), kind: b.kind === "hole" ? "hole" : "plate", text: s(b.text, 200),
    img: okImg(b.img) ? b.img : "", width: s(b.width, 20), plen: s(b.plen, 20),
    turn: [0, 90, 180, 270].includes(Number(b.turn)) ? Number(b.turn) : 0, keepShape: !!b.keepShape,
    fsz: Number(b.fsz) > 0 ? Math.max(4, Math.min(40, Number(b.fsz))) : "", ta: ["left", "center", "right"].includes(b.ta) ? b.ta : "",
  };
}

export default async (req: Request) => {
  const denied = checkAccess(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const blobs = store();
  try {
    if (req.method === "GET") {
      const want = norm(url.searchParams.get("customer") || "");
      const { blobs: list } = await blobs.list({ prefix: "p/" });
      const plates = (await Promise.all(list.slice(0, 300).map(async (b) => {
        const v: any = await blobs.get(b.key, { type: "json" });
        return v && (!want || norm(v.customer || "") === want) ? { id: b.key.slice(2), ...v } : null;
      }))).filter(Boolean).sort((a: any, b: any) => String(b.savedAt).localeCompare(String(a.savedAt)));
      return Response.json({ plates });
    }
    if (req.method === "PUT") {
      if (!okId(id)) return Response.json({ error: "Bad id" }, { status: 400 });
      const raw = await req.text();
      if (raw.length > 600_000) return Response.json({ error: "That picture is too big to keep" }, { status: 413 });
      const b = JSON.parse(raw), doc = clean(b), savedBy = s(b.savedBy, 80);
      if (!doc.customer) return Response.json({ error: "Add the customer first" }, { status: 400 });
      if (!doc.img && !doc.text) return Response.json({ error: "Nothing to keep: the plate has no picture or copy" }, { status: 400 });
      const saved = { ...doc, savedBy, savedAt: new Date().toISOString() };
      await blobs.setJSON("p/" + id, saved);
      return Response.json({ plate: { id, ...saved } });
    }
    if (req.method === "DELETE") {
      if (!okId(id)) return Response.json({ error: "Bad id" }, { status: 400 });
      await blobs.delete("p/" + id);
      return Response.json({ ok: true });
    }
    return new Response("Method not allowed", { status: 405 });
  } catch (e: any) {
    console.error("platelib error", e?.message);
    return Response.json({ error: "Could not reach storage. Try again." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/platelib" };
