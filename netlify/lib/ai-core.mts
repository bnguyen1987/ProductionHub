import Anthropic from "@anthropic-ai/sdk";

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
Scans are often poor: faint, skewed, faxed, or turned sideways / upside down. Read each page in whatever orientation makes the text upright. Never refuse or reply in words: always return the JSON, with null for anything you truly cannot read, and say what was unclear in "unclear".
You may get several attachments, or one PDF with several pages. At this plant the FIRST attachment (or page 1) is usually the BOX MEASUREMENT drawing (box size, blank size, score / panel dimensions) and the SECOND attachment (or page 2) is usually the PRINT LAYOUT (where the print goes, plate copy, ink, BMC).
Take box size, blank size, width_panels and length_panels from the measurement drawing. Take printed panels, plates, the BMC and print notes from the print layout. Header fields (customer, ship to, file/spec #, board, routing, dates) can come from either page.
If the two attachments disagree on a size or score, use the measurement drawing and add a line to "changes" saying what the print layout had.
If the attachments come in a different order (for example the print layout first), work out which is which from what they show.
Write all dimensions as inches with sixteenths fractions, like "34 1/16" or "4 7/8". Plant spec sheets write sixteenths after a colon, backtick or dash: 10:05 = 10 5/16, 54:03 = 54 3/16, 1:08 = 1 1/2, 30:14 = 30 7/8, 131:02 = 131 1/8, 33\`08 or 33-8 = 33 1/2. Never read 10:05 as 10.05.
On the measurement drawing, the numbers along the top/bottom edges are the length panels (glue flap first, e.g. 1:08 | 10:05 | 54:05 | 10:05 | 54:03) and the numbers down the sides are the width panels (e.g. 10:00 | 10:14 | 10:00). Ignore running totals (e.g. 66:02, 76:07, 130:10 are cumulative).
HANDWRITTEN corrections, cross-outs or notes win over the printed value: use the corrected value in the fields and list each one in "changes" with the old value, e.g. "Board updated: 200# C Kraft -> ECT 32 C" or "Panel scores updated (old sheet: 4 3/4 | 9 5/8 | 4 15/16 | 9 5/8 | 4 13/16)".
Panels: width_panels are the score panels ACROSS the sheet width, top to bottom as drawn (they add up to the blank width). length_panels are the score panels ALONG the sheet length, left to right (they add up to the scored length; for an RSC this is glue flap, L, W, L, W). Leave a list empty if the sheet does not show it.
printed_panels: 1-based numbers of the width panels that receive print.
plates: each print plate / copy block. panel = the 1-based width panel it sits on. start_in = inches from the LEFT edge of the blank to the left side of the plate (if the sheet says "start print 18 in from the score" and that score is at 4 3/4, start_in is 22.75). width_in = plate length along the sheet; if not given, work it out from the stated gaps ("60 in between plates") or estimate. text = the copy on the plate in a few words. upside_down = true if the copy is printed upside down on the drawing.
Return strict JSON only, no markdown fences, no commentary:
{"customer":string|null,"ship_to":string|null,"file_no":string|null,"spec_no":string|null,"design_no":string|null,"ident":string|null,
"style":string|null,"size":string|null,"board":string|null,"blank_width":string|null,"blank_length":string|null,
"print":string|null,"routing":string|null,"view":"Outside|Inside"|null,
"width_panels":[string],"length_panels":[string],"printed_panels":[number],
"plates":[{"panel":number,"length_panel":number|null,"align":"left|center|right","offset_in":number|null,"start_in":number|null,"width_in":number|null,"text":string,"upside_down":boolean,"source":{"file":number,"page":number,"box":[left,top,right,bottom],"rotation":0|90|180|270}|null}],
"bmc":{"present":boolean,"test":"ECT|Mullen"|null,"wall":"single|double"|null,"value":number|null,"panel":number|null,"length_panel":number|null,"align":"left|center|right","start_in":number|null,"upside_down":boolean,"written":string|null,"extra_text":string|null},
"texts":[{"panel":number,"length_panel":number|null,"align":"left|center|right","offset_in":number|null,"start_in":number|null,"text":string,"upside_down":boolean}],
"notes":[string],"changes":[string],"original_date":string|null,"sales":string|null,"designer":string|null,
"confidence":"high|medium|low","unclear":"one short sentence on anything you could not read, or empty"}
POSITIONS (plates, texts, BMC): print layout drawings are usually hand drawn and NOT to scale, so never measure positions off the drawing.
- panel = the width row it sits in (1 = top flap row, then body, then bottom flap).
- length_panel = which length panel (column) it sits in, counted left to right in the SAME order as length_panels, where the glue flap (if listed) is 1. The print layout drawing often leaves the glue flap out: then its first column is length panel 2, its second column is length panel 3, and so on. Match columns by the score/slot lines drawn on the print layout and by panel size (long vs short panels) against the measurement drawing.
- align = where it sits inside that panel as drawn: left, center or right. offset_in = a distance the sheet WRITES from that panel's score on the align side, else null.
- start_in only if the sheet writes an exact distance from the left edge of the blank, else null. width_in only if written, else null.
- Copy that is printed upside down on the drawing has upside_down true. Keep each text block's line breaks with \n.
- For the BMC: extra_text = words written right beside the BMC (like the box size "54 X 10 X 10"); do not repeat those in texts.
plate source: where that plate's logo/artwork is drawn on the uploaded pages, so the page can cut it out. file = attachment number (1 if only one), page = page number inside that attachment (1-based), box = a snug box around the logo or copy block (include its border if it has one) as fractions of that page's width/height from the top-left (0 to 1). rotation = degrees to turn the cut-out clockwise so the artwork reads upright (0 if the page is upright; 90 if the page is scanned turned a quarter to the left, so the text runs bottom to top; 270 if it runs top to bottom; 180 if upside down). Use null if the artwork is not shown.
BMC = Box Maker's (Manufacturer's) Certificate stamp. It is often only a handwritten note like "BMC 32 ECT P2", "cert on flap", "200# cert" or a hand-drawn circle. Set bmc.present true when the sheet asks for one. Take test/value from the note; if the note gives none, use the board grade (200# = Mullen 200, ECT 32 = ECT 32); double wall for BC/DW board. panel/start_in only if the sheet shows where it goes, else null. written = the note word for word.
texts: other short words the old sheet places ON the blank drawing that are not print plates (e.g. "THIS SIDE UP" marks or handwritten callouts that belong on a panel). Leave empty if none; general instructions go in notes.
Keep it short: at most 12 plates, 12 texts and 12 notes, each a few words. Never repeat an item. Ignore rows of #, dots or dashes (they are drawing marks).
size is the box size as written (L x W x D). print is like "1 color - BLACK ink". notes are short production/print notes in plain words (one idea each). Use null when a value is not on the sheet.`;


const PROMPTS: Record<string, string> = { ink: INK_PROMPT, quote: QUOTE_PROMPT, dieline: DIELINE_PROMPT, layout: LAYOUT_PROMPT };
export const TASKS = Object.keys(PROMPTS);

// Validate the request body. Returns an error string or the clean file list.
export function checkFiles(body: any): { error?: string; files?: any[] } {
  const files: any[] = Array.isArray(body?.files) ? body.files.slice(0, 4) : [{ data: body?.data, mediaType: body?.mediaType }];
  if (!TASKS.includes(body?.task) || !files.length || files.some((f) => typeof f?.data !== "string" || !f?.mediaType)) return { error: "Missing file or task" };
  if (files.some((f) => f.mediaType !== "application/pdf" && !/^image\/(jpeg|png|webp|gif)$/.test(f.mediaType))) return { error: "Upload a photo (JPG/PNG) or a PDF." };
  return { files };
}
export const aiReady = () => !!(process.env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_API_KEY);

// Cut-off JSON: cut back to the last complete value and close the open brackets. Returns the object or null.
function salvageJson(text: string): any {
  const start = text.indexOf("{");
  if (start < 0) return null;
  const t = text.slice(start);
  const stack: string[] = [];
  let inStr = false, esc = false, lastCut = -1, cutStack: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") { stack.pop(); if (stack.length) { lastCut = i + 1; cutStack = [...stack]; } }
    else if (c === ",") { lastCut = i; cutStack = [...stack]; }
  }
  if (lastCut < 0) return null;
  try { return JSON.parse(t.slice(0, lastCut).replace(/,\s*$/, "") + cutStack.reverse().join("")); } catch { return null; }
}

// Runs one AI read. Returns { status, body } ready to send back.
export async function runAi(task: string, files: any[]): Promise<{ status: number; body: any }> {
  const blockOf = (f: any): any => f.mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
    : { type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } };
  const content: any[] = [];
  files.forEach((f, i) => {
    if (files.length > 1) content.push({ type: "text", text: `Attachment ${i + 1}${f.name ? ` (${String(f.name).slice(0, 80)})` : ""}:` });
    content.push(blockOf(f));
  });
  try {
    const client = new Anthropic({ timeout: 10 * 60 * 1000, maxRetries: 1 });
    // Streamed, so a long read (busy scans take over a minute) is not cut off by the 60 s limit on a single wait.
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: task === "layout" ? 16000 : 1200,
      temperature: 0,
      messages: [{ role: "user", content: [...content, { type: "text", text: PROMPTS[task] }] }],
    });
    const msg: any = await stream.finalMessage();
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    if (msg.stop_reason === "max_tokens") {
      // ran out of room: keep every field that was finished
      const fixed = salvageJson(text);
      if (fixed) return { status: 200, body: { result: { ...fixed, unclear: [fixed.unclear, "The AI ran out of room, so some items at the end may be missing."].filter(Boolean).join(" ") } } };
    }
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) { console.error("AI no JSON", task, msg.stop_reason, text.slice(0, 300)); return { status: 422, body: { error: "AI could not read that file. Try a clearer photo or enter values by hand." } }; }
    try { return { status: 200, body: { result: JSON.parse(match[0]) } }; }
    catch { console.error("AI bad JSON", task, msg.stop_reason, text.length); return { status: 422, body: { error: msg.stop_reason === "max_tokens" ? "The sheet had more on it than the AI could write back. Try uploading just the print layout page." : "AI could not read that file. Try again, or enter values by hand." } }; }
  } catch (e: any) {
    console.error("AI error", task, e?.status, e?.message);
    return { status: 502, body: { error: "AI request failed. Try again, or enter values by hand." } };
  }
}
