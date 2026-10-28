import { createFileRoute } from "@tanstack/react-router";
import { corsHeaders, corsPreflight } from "@/lib/cors";

const METHODS = "GET, POST, OPTIONS";

function shopJson(request: Request, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request, METHODS),
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/public/v1/shop/offers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { orderTotalOre } = await import("@/lib/shop-order");
        const { offerByToken } = await import("@/lib/shop-order.server");
        const token = new URL(request.url).searchParams.get("token") ?? "";
        if (!token) return shopJson(request, { error: "closed" }, 400);
        try {
          const offer = await offerByToken(token);
          if (!offer) return shopJson(request, { error: "closed" }, 400);
          const boxes =
            offer.status === "offer" && offer.offerBoxes ? offer.offerBoxes : offer.boxes;
          const fulfillment =
            offer.status === "offer" && offer.offerFulfillment
              ? offer.offerFulfillment
              : offer.fulfillment;
          const freightOre =
            offer.status === "offer"
              ? offer.offerFulfillment === "pickup"
                ? 0
                : offer.offerFreightOre
              : offer.fulfillment === "pickup"
                ? 0
                : offer.freightOre;
          const goodsOre = orderTotalOre(boxes);
          return shopJson(request, {
            number: offer.orderNumber,
            flavorName: offer.flavorName,
            boxes,
            goodsOre,
            freightOre,
            totalOre: goodsOre + (freightOre ?? 0),
            fulfillment,
            note: offer.status === "offer" ? offer.offerNote : offer.deliveryNote,
            lang: offer.lang,
            status: offer.status,
          });
        } catch {
          return shopJson(request, { error: "closed" }, 400);
        }
      },
      POST: async ({ request }) => {
        const { acceptShopOffer } = await import("@/lib/shop-order.server");
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return shopJson(request, { error: "closed" }, 400);
        }
        const token =
          body &&
          typeof body === "object" &&
          typeof (body as { token?: unknown }).token === "string"
            ? (body as { token: string }).token
            : "";
        if (!token) return shopJson(request, { error: "closed" }, 400);
        try {
          const saved = await acceptShopOffer(token);
          if (!saved.ok && saved.reason === "stock")
            return shopJson(request, { error: "stock" }, 409);
          if (!saved.ok) return shopJson(request, { error: "closed" }, 400);
          return shopJson(request, { ok: true, number: saved.number });
        } catch {
          return shopJson(request, { error: "closed" }, 400);
        }
      },
      OPTIONS: async ({ request }) => corsPreflight(request, METHODS),
    },
  },
});
