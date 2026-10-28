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

export const Route = createFileRoute("/api/public/v1/shop/delivery")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { orderTotalOre } = await import("@/lib/shop-order");
        const { quoteDeliveryAddress } = await import("@/lib/delivery-zone.server");
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return shopJson(request, { error: "invalid" }, 400);
        }
        if (!body || typeof body !== "object") return shopJson(request, { error: "invalid" }, 400);
        const row = body as Record<string, unknown>;
        const addressLine = typeof row["addressLine"] === "string" ? row["addressLine"] : "";
        const postalCode = typeof row["postalCode"] === "string" ? row["postalCode"] : "";
        const city = typeof row["city"] === "string" ? row["city"] : "";
        const boxes = typeof row["boxes"] === "number" ? Math.floor(row["boxes"]) : 1;
        if (!addressLine || !postalCode || !city || boxes < 1) {
          return shopJson(request, { error: "invalid" }, 400);
        }
        try {
          const quote = await quoteDeliveryAddress({ addressLine, postalCode, city });
          if (!quote) return shopJson(request, { error: "unavailable" }, 503);
          const goodsOre = orderTotalOre(boxes);
          return shopJson(request, {
            zone: quote.zone,
            freightOre: quote.freightOre,
            distanceM: quote.distanceM,
            goodsOre,
            totalOre: quote.freightOre == null ? null : goodsOre + quote.freightOre,
          });
        } catch {
          return shopJson(request, { error: "unavailable" }, 503);
        }
      },
      OPTIONS: async ({ request }) => corsPreflight(request, METHODS),
    },
  },
});
