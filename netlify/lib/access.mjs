// Shared access-code check. The code lives only in the Netlify environment variable
// PROD_ACCESS_CODE (marked secret) so it never appears in this public repo.
// To change it: Netlify → Project configuration → Environment variables → PROD_ACCESS_CODE, then redeploy.
export function checkAccess(req) {
  const expected = (process.env.PROD_ACCESS_CODE || "").trim();
  if (!expected) return Response.json({ error: "Access code is not set up on the server" }, { status: 503 });
  const given = (req.headers.get("x-access-code") || "").trim();
  if (given !== expected) return Response.json({ error: "Wrong access code" }, { status: 401 });
  return null;
}
