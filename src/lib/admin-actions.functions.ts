import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ADMIN_ACTION_TYPES,
  isAdminActionType,
} from "@/lib/admin-actions";
import {
  approveAdminAction,
  proposeAdminAction,
  rejectAdminAction,
  validateProposal,
} from "@/lib/admin-actions.server";

async function assertOperations(supabase: {
  rpc: (
    fn: "can_manage_operations",
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}) {
  const { data, error } = await supabase.rpc("can_manage_operations");
  if (error) throw new Error(`Could not verify operations access: ${error.message}`);
  if (data !== true) throw new Error("Not authorized");
}

const proposeSchema = z.object({
  actionType: z.string(),
  title: z.string().trim().min(1),
  rationale: z.string().optional(),
  payload: z.unknown(),
});

export const listAdminActionProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOperations(context.supabase as never);
    const { data, error } = await context.supabase
      .from("admin_action_proposals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { proposals: data ?? [] };
  });

export const proposeAdminActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => proposeSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertOperations(context.supabase as never);
    if (!isAdminActionType(data.actionType)) {
      throw new Error(`unsupported action type: ${data.actionType}`);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = typeof context.userId === "string" ? context.userId : null;
    return proposeAdminAction(supabaseAdmin, {
      actionType: data.actionType,
      title: data.title,
      rationale: data.rationale,
      payload: data.payload,
      proposedBy: "human",
      proposedByUserId: userId,
    });
  });

export const approveAdminActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ proposalId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertOperations(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = typeof context.userId === "string" ? context.userId : null;
    return approveAdminAction(supabaseAdmin, data.proposalId, userId, "human");
  });

export const rejectAdminActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ proposalId: z.string().uuid(), reason: z.string().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertOperations(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = typeof context.userId === "string" ? context.userId : null;
    return rejectAdminAction(supabaseAdmin, data.proposalId, userId, data.reason);
  });

export const validateAdminActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ actionType: z.string(), payload: z.unknown() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertOperations(context.supabase as never);
    if (!isAdminActionType(data.actionType)) {
      throw new Error(`unsupported action type: ${data.actionType}`);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return validateProposal(supabaseAdmin, data.actionType, data.payload);
  });

export const ADMIN_ACTION_TYPE_LIST = ADMIN_ACTION_TYPES;
