import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { checkAccess } from "../lib/access.mjs";

// Print Layouts tab: redrawn spec sheets. One blob per layout ("l/<id>").
// GET → list (summary only), GET ?id= → one layout, PUT ?id= → save, DELETE ?id= → remove.
// Versions: each save first copies the previous doc to "v/<id>/<time>"; the last 10 are kept.
//   GET ?id=&versions=1 → list, GET ?id=&version=<time> → that version.
// Original scans: "o/<id>/<n>" (the uploaded PDF / photo, as is).
//   PUT ?id=&original=<n> {name, mediaType, data(base64)} → store, GET ?id=&original=<n> → the file.
const store = () => getStore({ name: "print-layouts", consistency: "strong" });
const s = (v: any, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const okId = (id: string) => /^[A-Za-z0-9_-]{4,40}$/.test(id);
const KEEP_VERSIONS = 10;
const delPrefix = async (blobs: any, prefix: string) => { const { blobs: list } = await blobs.list({ prefix }); await Promise.all(list.map((b: any) => blobs.delete(b.key))); };
const FIELDS = ["customer", "shipTo", "fileNo", "specNo", "plateNo", "design", "ident", "style", "size", "board", "blankW", "blankL",
  "print", "routing", "view", "widthPanels", "lengthPanels", "origDate", "revDate", "sales", "designer", "approved", "glueTab", "slots", "flapEnds", "mm", "joint", "plateSizes", "units"];

function clean(b: any) {
  const doc: any = {};
  for (const k of FIELDS) doc[k] = s(b[k], 300);
  doc.printPanels = (Array.isArray(b.printPanels) ? b.printPanels : []).map((n: any) => parseInt(n, 10)).filter((n: number) => n >= 1 && n <= 20).slice(0, 20);
  doc.plates = (Array.isArray(b.plates) ? b.plates : []).slice(0, 40).map((p: any) => ({
    panel: Math.max(1, Math.min(20, parseInt(p?.panel, 10) || 1)),
    start: s(p?.start, 20), width: s(p?.width, 20), plen: s(p?.plen, 20), text: s(p?.text, 200), flip: !!p?.flip, nodetail: !!p?.nodetail, keepShape: !!p?.keepShape, nosize: !!p?.nosize, turn: [0, 90, 180, 270].includes(Number(p?.turn)) ? Number(p.turn) : 0, hl: !!p?.hl, nodim: !!p?.nodim, dy: Math.max(-0.5, Math.min(0.5, Number(p?.dy) || 0)), hgt: Math.max(0, Math.min(0.98, Number(p?.hgt) || 0)), ta: ["left", "center", "right"].includes(p?.ta) ? p.ta : "", fsz: Number(p?.fsz) > 0 ? Math.max(4, Math.min(40, Number(p.fsz))) : "",
    img: typeof p?.img === "string" && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(p.img) && p.img.length < 400_000 ? p.img : "",
    kind: ["plate", "bmc", "text", "hole"].includes(p?.kind) ? p.kind : "plate", hole: p?.hole === "hinge" ? "hinge" : "cut",
    test: p?.test === "Mullen" ? "Mullen" : "ECT", wall: p?.wall === "double" ? "double" : "single", rating: s(p?.rating, 6), size: ["XS", "S", "M", "L"].includes(p?.size) ? p.size : "M",
  }));
  doc.notes = s(b.notes, 4000);
  doc.changes = s(b.changes, 4000);
  doc.detailTexts = (Array.isArray(b.detailTexts) ? b.detailTexts : b.detailText ? [b.detailText] : []).slice(0, 4).map((x: any) => s(x, 1000)).filter(Boolean);
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
        if (url.searchParams.has("versions")) {
          const { blobs: list } = await blobs.list({ prefix: "v/" + id + "/" });
          const versions = (await Promise.all(list.map(async (b) => {
            const v: any = await blobs.get(b.key, { type: "json" });
            return v ? { ts: b.key.split("/").pop(), updatedBy: v.updatedBy || "", updatedAt: v.updatedAt || "" } : null;
          }))).filter(Boolean).sort((a: any, b: any) => String(b.ts).localeCompare(String(a.ts)));
          return Response.json({ versions });
        }
        const ver = url.searchParams.get("version");
        if (ver) {
          if (!/^\d{13}$/.test(ver)) return Response.json({ error: "Bad version" }, { status: 400 });
          const v = await blobs.get("v/" + id + "/" + ver, { type: "json" });
          return v ? Response.json({ layout: { id, ...v } }) : Response.json({ error: "That version is gone" }, { status: 404 });
        }
        const on = url.searchParams.get("original");
        if (on !== null) {
          if (!/^[0-3]$/.test(on)) return Response.json({ error: "Bad file" }, { status: 400 });
          const r: any = await blobs.getWithMetadata("o/" + id + "/" + on, { type: "arrayBuffer" });
          if (!r) return Response.json({ error: "Original not found" }, { status: 404 });
          const name = String(r.metadata?.name || "original").replace(/[^\w .()-]/g, "_");
          return new Response(r.data, { headers: { "content-type": String(r.metadata?.mediaType || "application/octet-stream"), "content-disposition": `inline; filename="${name}"`, "cache-control": "private, max-age=3600" } });
        }
        const v = await blobs.get("l/" + id, { type: "json" });
        return v ? Response.json({ layout: { id, ...v } }) : Response.json({ error: "Not found" }, { status: 404 });
      }
      const { blobs: list } = await blobs.list({ prefix: "l/" });
      const layouts = (await Promise.all(list.map(async (b) => {
        const v: any = await blobs.get(b.key, { type: "json" });
        return v ? { id: b.key.slice(2), customer: v.customer, fileNo: v.fileNo, specNo: v.specNo, plateNo: v.plateNo, design: v.design, style: v.style, updatedBy: v.updatedBy, updatedAt: v.updatedAt } : null;
      }))).filter(Boolean).sort((a: any, b: any) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return Response.json({ layouts });
    }
    if (req.method === "PUT") {
      if (!okId(id)) return Response.json({ error: "Bad id" }, { status: 400 });
      const raw = await req.text();
      if (raw.length > 5_800_000) return Response.json({ error: "That is too big to save" }, { status: 413 });
      const b = JSON.parse(raw);
      // original scan upload (one file per request)
      const on = url.searchParams.get("original");
      if (on !== null) {
        if (!/^[0-3]$/.test(on)) return Response.json({ error: "Bad file" }, { status: 400 });
        const mediaType = String(b.mediaType || "");
        if (mediaType !== "application/pdf" && !/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(mediaType)) return Response.json({ error: "Only PDFs and photos can be kept" }, { status: 400 });
        const bytes = Uint8Array.from(Buffer.from(String(b.data || ""), "base64"));
        if (!bytes.length) return Response.json({ error: "Empty file" }, { status: 400 });
        const name = s(b.name, 120) || "original";
        await blobs.set("o/" + id + "/" + on, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { metadata: { name, mediaType } });
        const cur: any = await blobs.get("l/" + id, { type: "json" });
        if (cur) {
          const originals = Array.isArray(cur.originals) ? cur.originals.slice(0, 4) : [];
          originals[+on] = { name, mediaType, size: bytes.length };
          cur.originals = originals.map((x: any) => x || null);
          await blobs.setJSON("l/" + id, cur);
          return Response.json({ originals: cur.originals });
        }
        return Response.json({ originals: [] });
      }
      const updatedBy = s(b.updatedBy, 80);
      if (!updatedBy) return Response.json({ error: "Your name is required" }, { status: 400 });
      const prev: any = await blobs.get("l/" + id, { type: "json" });
      if (prev) {
        // keep the previous save as a version, then trim to the last few
        await blobs.setJSON("v/" + id + "/" + String(Date.now()).padStart(13, "0"), prev);
        const { blobs: vl } = await blobs.list({ prefix: "v/" + id + "/" });
        const old = vl.map((x) => x.key).sort().slice(0, Math.max(0, vl.length - KEEP_VERSIONS));
        await Promise.all(old.map((k) => blobs.delete(k)));
      }
      // a new scan replaces the old one: the page uploads the new files right after this save
      let originals = prev && Array.isArray(prev.originals) ? prev.originals : [];
      if (b.newOriginals) { await delPrefix(blobs, "o/" + id + "/"); originals = []; }
      const doc = { ...clean(b), originals, updatedBy, updatedAt: new Date().toISOString() };
      await blobs.setJSON("l/" + id, doc);
      return Response.json({ layout: { id, ...doc } });
    }
    if (req.method === "DELETE") {
      if (!okId(id)) return Response.json({ error: "Bad id" }, { status: 400 });
      await blobs.delete("l/" + id);
      await delPrefix(blobs, "v/" + id + "/");
      await delPrefix(blobs, "o/" + id + "/");
      return Response.json({ ok: true });
    }
    return new Response("Method not allowed", { status: 405 });
  } catch (e: any) {
    console.error("layouts error", e?.message);
    return Response.json({ error: "Could not reach storage. Try again." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/layouts" };
