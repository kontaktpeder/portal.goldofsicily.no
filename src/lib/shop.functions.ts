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

/** After a new batch is stored, tell waitlist customers whose flavour now has a 50-box. */
export const flushShopRestock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOperations(context.supabase as never);
    const { notifyAvailableFlavors } = await import("@/lib/shop.server");
    return notifyAvailableFlavors();
  });
