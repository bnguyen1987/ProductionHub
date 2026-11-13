import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { checkAccess } from "../lib/access.mjs";

// Print Layouts tab: redrawn spec sheets. One blob per layout ("l/<id>").
// GET → list (summary only), GET ?id= → one layout, PUT ?id= → save, DELETE ?id= → remove.
const store = () => getStore({ name: "print-layouts", consistency: "strong" });
const s = (v: any, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const okId = (id: string) => /^[A-Za-z0-9_-]{4,40}$/.test(id);
const FIELDS = ["customer", "shipTo", "fileNo", "specNo", "design", "ident", "style", "size", "board", "blankW", "blankL",
  "print", "routing", "view", "widthPanels", "lengthPanels", "origDate", "revDate", "sales", "designer", "approved", "glueTab"];

function clean(b: any) {
  const doc: any = {};
  for (const k of FIELDS) doc[k] = s(b[k], 300);
  doc.printPanels = (Array.isArray(b.printPanels) ? b.printPanels : []).map((n: any) => parseInt(n, 10)).filter((n: number) => n >= 1 && n <= 20).slice(0, 20);
  doc.plates = (Array.isArray(b.plates) ? b.plates : []).slice(0, 40).map((p: any) => ({
    panel: Math.max(1, Math.min(20, parseInt(p?.panel, 10) || 1)),
    start: s(p?.start, 20), width: s(p?.width, 20), text: s(p?.text, 200), flip: !!p?.flip, hl: !!p?.hl, nodim: !!p?.nodim, dy: Math.max(-0.45, Math.min(0.45, Number(p?.dy) || 0)),
    img: typeof p?.img === "string" && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(p.img) && p.img.length < 400_000 ? p.img : "",
    kind: ["plate", "bmc", "text"].includes(p?.kind) ? p.kind : "plate",
    test: p?.test === "Mullen" ? "Mullen" : "ECT", wall: p?.wall === "double" ? "double" : "single", rating: s(p?.rating, 6), size: ["XS", "S", "M", "L"].includes(p?.size) ? p.size : "M",
  }));
  doc.notes = s(b.notes, 4000);
  doc.changes = s(b.changes, 4000);
  doc.detailText = s(b.detailText, 2000);
  doc.detailLogos = b.detailLogos !== false;
  const okImg = (v: any) => typeof v === "string" && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 400_000;
  doc.details = (Array.isArray(b.details) ? b.details : []).slice(0, 3).filter((x: any) => okImg(x?.img)).map((x: any) => ({ img: x.img, caption: s(x.caption, 80) }));
  return doc;
}

export default async (req: Request) => {
  const denied = checkAccess(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const blobs = store();
  try {
    if (req.method === "GET") {
      if (id) {
        if (!okId(id)) return Response.json({ error: "Bad id" }, { status: 400 });
        const v = await blobs.get("l/" + id, { type: "json" });
        return v ? Response.json({ layout: { id, ...v } }) : Response.json({ error: "Not found" }, { status: 404 });
      }
      const { blobs: list } = await blobs.list({ prefix: "l/" });
      const layouts = (await Promise.all(list.map(async (b) => {
        const v: any = await blobs.get(b.key, { type: "json" });
        return v ? { id: b.key.slice(2), customer: v.customer, fileNo: v.fileNo, specNo: v.specNo, design: v.design, style: v.style, updatedBy: v.updatedBy, updatedAt: v.updatedAt } : null;
      }))).filter(Boolean).sort((a: any, b: any) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return Response.json({ layouts });
    }
    if (req.method === "PUT") {
      if (!okId(id)) return Response.json({ error: "Bad id" }, { status: 400 });
      const raw = await req.text();
      if (raw.length > 3_000_000) return Response.json({ error: "Too much text" }, { status: 413 });
      const b = JSON.parse(raw);
      const updatedBy = s(b.updatedBy, 80);
      if (!updatedBy) return Response.json({ error: "Your name is required" }, { status: 400 });
      const doc = { ...clean(b), updatedBy, updatedAt: new Date().toISOString() };
      await blobs.setJSON("l/" + id, doc);
      return Response.json({ layout: { id, ...doc } });
    }
    if (req.method === "DELETE") {
      if (!okId(id)) return Response.json({ error: "Bad id" }, { status: 400 });
      await blobs.delete("l/" + id);
      return Response.json({ ok: true });
    }
    return new Response("Method not allowed", { status: 405 });
  } catch (e: any) {
    console.error("layouts error", e?.message);
    return Response.json({ error: "Could not reach storage. Try again." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/layouts" };
