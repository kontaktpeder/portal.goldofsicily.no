const ALLOWED_ORIGIN =
  /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/([a-z0-9-]+\.)*goldofsicily\.no|https:\/\/([a-z0-9-]+\.)*lovable\.app|https:\/\/([a-z0-9-]+\.)*lovableproject\.com)$/i;

export function corsHeaders(request: Request, methods = "GET, OPTIONS") {
  const origin = request.headers.get("Origin") ?? "";
  const allow = ALLOWED_ORIGIN.test(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function jsonPublic(request: Request, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request),
      "Cache-Control": "public, max-age=60, s-maxage=120",
    },
  });
}

export function corsPreflight(request: Request, methods = "GET, OPTIONS") {
  return new Response(null, { status: 204, headers: corsHeaders(request, methods) });
}
