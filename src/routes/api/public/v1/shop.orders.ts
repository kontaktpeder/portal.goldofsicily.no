import { createFileRoute } from "@tanstack/react-router";
import { corsHeaders, corsPreflight } from "@/lib/cors";

const METHODS = "POST, OPTIONS";

function shopJson(request: Request, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request, METHODS),
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/public/v1/shop/orders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { parseShopOrder } = await import("@/lib/shop-order");
        const { placeShopOrder } = await import("@/lib/shop-order.server");
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return shopJson(request, { error: "invalid" }, 400);
        }
        const input = parseShopOrder(body);
        if (!input) return shopJson(request, { error: "invalid" }, 400);
        try {
          const saved = await placeShopOrder(input);
          if (!saved.ok && saved.reason === "short")
            return shopJson(request, { error: "short" }, 409);
          if (!saved.ok && saved.reason === "invalid")
            return shopJson(request, { error: "invalid" }, 400);
          if (!saved.ok) return shopJson(request, { error: "unavailable" }, 503);
          return shopJson(request, { ok: true, number: saved.order.orderNumber, kind: saved.kind });
        } catch {
          return shopJson(request, { error: "unavailable" }, 503);
        }
      },
      OPTIONS: async ({ request }) => corsPreflight(request, METHODS),
    },
  },
});
