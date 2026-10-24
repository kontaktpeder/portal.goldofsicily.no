import { createFileRoute } from "@tanstack/react-router";
import { corsHeaders, corsPreflight } from "@/lib/cors";

const SHOP_METHODS = "GET, POST, OPTIONS";

function shopJson(request: Request, body: unknown, status = 200, cache = false) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request, SHOP_METHODS),
      "Cache-Control": cache ? "public, max-age=15" : "no-store",
    },
  });
}

export const Route = createFileRoute("/api/public/v1/shop")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { loadPublicShop } = await import("@/lib/shop.server");
        const shop = await loadPublicShop();
        return shopJson(request, shop, 200, true);
      },
      POST: async ({ request }) => {
        const { parseWaitlist } = await import("@/lib/shop");
        const { notifyAvailableFlavors, saveWaitlist } = await import("@/lib/shop.server");
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return shopJson(request, { error: "invalid" }, 400);
        }
        const input = parseWaitlist(body);
        if (!input) return shopJson(request, { error: "invalid" }, 400);
        const saved = await saveWaitlist(input);
        if (!saved.ok) return shopJson(request, { error: "unavailable" }, 503);
        await notifyAvailableFlavors();
        return shopJson(request, { ok: true });
      },
      OPTIONS: async ({ request }) => corsPreflight(request, SHOP_METHODS),
    },
  },
});
