import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "@netlify/functions";
import { checkAccess } from "../lib/access.mjs";

const MODEL = "claude-sonnet-5-5";

const INK_PROMPT = `You are looking at a photo of a printed corrugated box sample sheet (flexo print).
Estimate ink coverage for each ink color printed on the sheet.
Coverage % = the share of the TOTAL sheet area covered by that ink (100 = solid flood coat over the whole sheet).
Ignore the bare board color (kraft brown or mottled/white) - that is not ink.
Line art, text and logos usually cover far less than people expect (often 3-20%). Be realistic.
Return strict JSON only, no markdown fences, no commentary:
{"colors":[{"name":"ink color name, e.g. Black, PMS Red","coverage_pct":number}],"board":"kraft|white|unknown","confidence":"high|medium|low","notes":"one short sentence on what you saw"}
List at most 4 colors, darkest/most coverage first.`;

const QUOTE_PROMPT = `You are reading a customer quote / RFQ / PO / spec sheet for a corrugated box plant.
Extract the order details. Dimensions in inches as decimals. Spec sheets often write sixteenths with a backtick or dash, e.g. 33\`08 or 33-8 means 33 8/16 = 33.5.
"Sheet" or "blank" size is the flat board size before folding (often written Width x Length, or "Finished WxL", or "Blank size").
Box dimensions are inside Length x Width x Depth.
Return strict JSON only, no markdown fences, no commentary:
{"customer":string|null,"part_or_design":string|null,"style":"RSC|HSC|FOL|Die Cut|Sheet|Other"|null,
"box_length_in":number|null,"box_width_in":number|null,"box_depth_in":number|null,
"sheet_width_in":number|null,"sheet_length_in":number|null,
"flute":"E|B|C|BC|A|SF"|null,"grade":string|null,"colors":number|null,"quantity":number|null,"number_up":number|null,
"notes":"one or two short sentences: anything unusual (glue, stitching, special print, tight tolerances)"}
For flute: use BC for any double wall (BC, DW, 2-wall). Use SF for single face. If something is not in the document use null.`;

export default async (req: Request) => {
  const denied = checkAccess(req);
  if (denied) return denied;
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  const { task, data, mediaType } = body || {};
  if (!["ink", "quote"].includes(task) || typeof data !== "string" || !mediaType) {
    return Response.json({ error: "Missing file or task" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "AI is not active on this site yet. Manual entry still works." }, { status: 503 });
  }

  const isPdf = mediaType === "application/pdf";
  if (!isPdf && !/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
    return Response.json({ error: "Upload a photo (JPG/PNG) or a PDF." }, { status: 400 });
  }
  const fileBlock: any = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data } };

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: task === "ink" ? INK_PROMPT : QUOTE_PROMPT }] }],
    });
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return Response.json({ error: "AI could not read that file. Try a clearer photo or enter values by hand." }, { status: 422 });
    return Response.json({ result: JSON.parse(match[0]) });
  } catch (e: any) {
    console.error("AI error", e?.status, e?.message);
    return Response.json({ error: "AI request failed. Try again, or enter values by hand." }, { status: 502 });
  }
};

export const config: Config = { path: "/api/ai" };
