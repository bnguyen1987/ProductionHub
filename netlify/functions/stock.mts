import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { checkAccess } from "../lib/access.mjs";

// Shared stock sheet list (parsed from the Export.xlsx upload) so everyone compares against the same data.
const store = () => getStore({ name: "stock-sheets", consistency: "strong" });
const KEY = "latest";

export default async (req: Request) => {
  const denied = checkAccess(req);
  if (denied) return denied;
  try {
    if (req.method === "GET") {
      const data = await store().get(KEY, { type: "json" });
      return Response.json(data || { items: [], fileName: null, uploadedAt: null });
    }
    if (req.method === "PUT") {
      const raw = await req.text();
      if (raw.length > 1_000_000) return Response.json({ error: "File has too many rows" }, { status: 413 });
      const body = JSON.parse(raw);
      const s = (v: any, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
      const num = (v: any) => (typeof v === "number" && isFinite(v) ? v : null);
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 3000).map((i: any) => ({
        desc: s(i.desc, 200), itemNo: s(i.itemNo, 40), grade: s(i.grade, 20), flute: s(i.flute, 10), color: s(i.color, 20),
        w: num(i.w), l: num(i.l), avail: num(i.avail), onHand: num(i.onHand),
      })).filter((i: any) => i.w && i.l);
      const data = { items, fileName: s(body.fileName, 200), uploadedAt: new Date().toISOString() };
      await store().setJSON(KEY, data);
      return Response.json(data);
    }
    return new Response("Method not allowed", { status: 405 });
  } catch (e: any) {
    console.error("stock error", e?.message);
    return Response.json({ error: "Could not reach storage. Try again." }, { status: 500 });
  }
};

export const config: Config = { path: "/api/stock" };
