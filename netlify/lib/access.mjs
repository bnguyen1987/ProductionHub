// Shared access-code check. The code can be changed in Netlify with the
// PROD_ACCESS_CODE environment variable (then redeploy).
const DEFAULT_CODE = "gwprod-727";

export function checkAccess(req) {
  const expected = (process.env.PROD_ACCESS_CODE || DEFAULT_CODE).trim().toLowerCase();
  const given = (req.headers.get("x-access-code") || "").trim().toLowerCase();
  if (given !== expected) return Response.json({ error: "Wrong access code" }, { status: 401 });
  return null;
}
