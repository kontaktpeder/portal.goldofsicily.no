import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertOperations(supabase: {
  rpc: (
    fn: "can_manage_operations",
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}) {
  const { data, error } = await supabase.rpc("can_manage_operations");
  if (error || data !== true) throw new Error("Not authorized");
}

export const listNettbestillinger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOperations(context.supabase as never);
    const { listShopOrders } = await import("@/lib/shop-order.server");
    return listShopOrders();
  });

export const approveNettbestilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await assertOperations(context.supabase as never);
    const { approveShopOrder } = await import("@/lib/shop-order.server");
    const actor = context.userId;
    return approveShopOrder(data.id, typeof actor === "string" ? actor : null);
  });

export const declineNettbestilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await assertOperations(context.supabase as never);
    const { declineShopOrder } = await import("@/lib/shop-order.server");
    return declineShopOrder(data.id);
  });

export const reviseNettbestilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { id: string; boxes: number; fulfillment: string; freightKr: number; note: string }) => {
      const fulfillment = data.fulfillment === "delivery_request" ? "delivery_request" : "pickup";
      const kroner = Math.round(Number(data.freightKr));
      return {
        id: data.id,
        boxes: Math.floor(Number(data.boxes)),
        fulfillment,
        freightOre: fulfillment === "pickup" ? 0 : kroner * 100,
        note: typeof data.note === "string" ? data.note.trim().slice(0, 160) : "",
      } as const;
    },
  )
  .handler(async ({ data, context }) => {
    await assertOperations(context.supabase as never);
    const { reviseShopOrder } = await import("@/lib/shop-order.server");
    const origin = process.env["SHOP_PUBLIC_ORIGIN"] ?? "https://goldofsicily.no";
    return reviseShopOrder(data.id, data, origin);
  });

/** After a new batch is stored, tell waitlist customers whose flavour now has a 50-box. */
export const flushShopRestock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOperations(context.supabase as never);
    const { notifyAvailableFlavors } = await import("@/lib/shop.server");
    return notifyAvailableFlavors();
  });
