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
Die line drawings (e.g. Esko/ArtiosCAD, ".ARD") list "Blank width" x "Blank height": use those as sheet width x length. "Pieces Per: 4 OUT" is number_up.
"Rules per inches", "Rule inches", "Total rule" or "Knife length" is the inches of cutting rule on the die: put it in rule_in. A die line with no box style given is "Die Cut".
Style codes: RSC, HSC, FOL, DST (tray style the plant runs on its folder-gluers), "Tube" (scored tube / sleeve). Anything else that is cut on a die is "Die Cut":
mailers, roll end tuck front (RETF), tuck tops, die-cut trays, pizza boxes, inserts, "w/ DFs" (dust flaps), FEFCO 04xx/02xx die cut styles, ArtiosCAD/Esko styles that are not plain RSC/HSC/FOL.
hand_holes is true if the drawing or quote shows hand holes / handholds / hand cutouts.
Return strict JSON only, no markdown fences, no commentary:
{"customer":string|null,"part_or_design":string|null,"style":"RSC|HSC|FOL|DST|Tube|Die Cut|Sheet|Other"|null,"hand_holes":boolean,
"box_length_in":number|null,"box_width_in":number|null,"box_depth_in":number|null,
"sheet_width_in":number|null,"sheet_length_in":number|null,
"flute":"E|B|C|BC|A|SF"|null,"grade":string|null,"colors":number|null,"quantity":number|null,"number_up":number|null,
"rule_in":number|null,"notes":"one or two short sentences: anything unusual (glue, stitching, special print, tight tolerances)"}
For flute: use BC for any double wall (BC, DW, 2-wall). Use SF for single face. If something is not in the document use null.`;

const DIELINE_PROMPT = `You are reading a die line / CAD drawing (e.g. Esko ArtiosCAD or a customer DXF printout) for a corrugated box plant.
Header fields often read like "Blank width: 34.0193", "Blank height: 44+1/2" (44+1/2 means 44.5), "Pieces Per: 4 OUT", "Board: 200 C Kraft", "Rules per inches: 866.8".
Return the overall blank (sheet) size in inches as decimals. If the drawing shows dimension lines for a single piece of a multi-out layout (e.g. 34 across for 2 pieces, 17 for one), also return one piece's width and length.
Return strict JSON only, no markdown fences, no commentary:
{"customer":string|null,"design":string|null,"description":string|null,"board":string|null,
"grade_number":number|null,"grade_ect":boolean,"flute":"E|B|C|BC|A|SF"|null,"color":"KRAFT|WHITE"|null,
"blank_width_in":number|null,"blank_length_in":number|null,"pieces_out":number|null,
"piece_width_in":number|null,"piece_length_in":number|null,"rule_in":number|null,
"drawing_box":[left,top,right,bottom]|null,"notes":"one short sentence or empty"}
drawing_box: where the outer cut lines of the whole blank (all pieces) sit on the page, as fractions of the page width/height from the top-left (0 to 1). Leave out the title block, dimension lines and border.
grade_number: the number in the board grade (200 in "200 C Kraft", 32 in "32 ECT B"); grade_ect true when the grade is ECT. Flute BC for any double wall (BC, DW). Use null when a value is not in the document.`;

const LAYOUT_PROMPT = `You are reading an OLD print layout / specification sheet for a corrugated box plant (often a scan or photo, sometimes with handwritten corrections).
The goal is to redraw it as a clean new spec sheet, so read every number carefully.
Write all dimensions as inches with sixteenths fractions, like "34 1/16" or "4 7/8" (spec sheets may write 33\`08 or 33-8, which means 33 8/16 = 33 1/2).
HANDWRITTEN corrections, cross-outs or notes win over the printed value: use the corrected value in the fields and list each one in "changes" with the old value, e.g. "Board updated: 200# C Kraft -> ECT 32 C" or "Panel scores updated (old sheet: 4 3/4 | 9 5/8 | 4 15/16 | 9 5/8 | 4 13/16)".
Panels: width_panels are the score panels ACROSS the sheet width, top to bottom as drawn (they add up to the blank width). length_panels are the score panels ALONG the sheet length, left to right (they add up to the scored length; for an RSC this is glue flap, L, W, L, W). Leave a list empty if the sheet does not show it.
printed_panels: 1-based numbers of the width panels that receive print.
plates: each print plate / copy block. panel = the 1-based width panel it sits on. start_in = inches from the LEFT edge of the blank to the left side of the plate (if the sheet says "start print 18 in from the score" and that score is at 4 3/4, start_in is 22.75). width_in = plate length along the sheet; if not given, work it out from the stated gaps ("60 in between plates") or estimate. text = the copy on the plate in a few words. upside_down = true if the copy is printed upside down on the drawing.
Return strict JSON only, no markdown fences, no commentary:
{"customer":string|null,"ship_to":string|null,"file_no":string|null,"spec_no":string|null,"design_no":string|null,"ident":string|null,
"style":string|null,"size":string|null,"board":string|null,"blank_width":string|null,"blank_length":string|null,
"print":string|null,"routing":string|null,"view":"Outside|Inside"|null,
"width_panels":[string],"length_panels":[string],"printed_panels":[number],
"plates":[{"panel":number,"start_in":number,"width_in":number,"text":string,"upside_down":boolean}],
"bmc":{"present":boolean,"test":"ECT|Mullen"|null,"wall":"single|double"|null,"value":number|null,"panel":number|null,"start_in":number|null,"upside_down":boolean,"written":string|null},
"texts":[{"panel":number,"start_in":number,"text":string,"upside_down":boolean}],
"notes":[string],"changes":[string],"original_date":string|null,"sales":string|null,"designer":string|null,
"confidence":"high|medium|low","unclear":"one short sentence on anything you could not read, or empty"}
BMC = Box Maker's (Manufacturer's) Certificate stamp. It is often only a handwritten note like "BMC 32 ECT P2", "cert on flap", "200# cert" or a hand-drawn circle. Set bmc.present true when the sheet asks for one. Take test/value from the note; if the note gives none, use the board grade (200# = Mullen 200, ECT 32 = ECT 32); double wall for BC/DW board. panel/start_in only if the sheet shows where it goes, else null. written = the note word for word.
texts: other short words the old sheet places ON the blank drawing that are not print plates (e.g. "THIS SIDE UP" marks or handwritten callouts that belong on a panel). Leave empty if none; general instructions go in notes.
size is the box size as written (L x W x D). print is like "1 color - BLACK ink". notes are short production/print notes in plain words (one idea each). Use null when a value is not on the sheet.`;

export default async (req: Request) => {
  const denied = checkAccess(req);
  if (denied) return denied;
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  const { task, data, mediaType } = body || {};
  if (!["ink", "quote", "dieline", "layout"].includes(task) || typeof data !== "string" || !mediaType) {
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
      max_tokens: task === "layout" ? 3000 : 1200,
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: task === "ink" ? INK_PROMPT : task === "dieline" ? DIELINE_PROMPT : task === "layout" ? LAYOUT_PROMPT : QUOTE_PROMPT }] }],
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
