import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { checkAccess } from "../lib/access.mjs";

// Shared pallet price list (parsed from the Pallet Costs and Sizes upload) so everyone uses the same prices.
const store = () => getStore({ name: "pallet-prices", consistency: "strong" });
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
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 500).map((i: any) => ({
        type: s(i.type, 120), w: num(i.w), l: num(i.l), cost: num(i.cost),
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

export const config: Config = { path: "/api/pallets" };
