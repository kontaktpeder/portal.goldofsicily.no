import { createFileRoute } from "@tanstack/react-router";
import { actionAccess, isAdminActionType, type ActionAccess } from "@/lib/admin-actions";
import {
  approveAdminAction,
  listAccountingDiscrepancies,
  proposeAdminAction,
  rejectAdminAction,
  validateProposal,
} from "@/lib/admin-actions.server";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function accessOf(request: Request): ActionAccess {
  return actionAccess({
    authorizationHeader: request.headers.get("authorization"),
    actionsToken: process.env["ARANCINI_ACTIONS_TOKEN"] ?? process.env["ADMIN_ACTIONS_TOKEN"],
    ownerToken: process.env["ARANCINI_OWNER_TOKEN"],
  });
}

function proposalIdOf(row: Record<string, unknown>): string {
  const value = row.proposalId ?? row.proposal_id;
  return typeof value === "string" ? value : "";
}

export const Route = createFileRoute("/api/admin/v1/actions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const access = accessOf(request);
        if (access === "none") return json({ error: "unauthorized" }, 401);
        const url = new URL(request.url);
        const view = url.searchParams.get("view");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (view === "discrepancies") {
          return json({
            access,
            discrepancies: await listAccountingDiscrepancies(supabaseAdmin),
          });
        }
        const { data, error } = await supabaseAdmin
          .from("admin_action_proposals")
          .select(
            "id, action_type, title, rationale, status, validation, result, error_message, proposed_by, created_at, approved_at, executed_at",
          )
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) return json({ error: error.message }, 500);
        return json({ access, proposals: data ?? [] });
      },
      POST: async ({ request }) => {
        const access = accessOf(request);
        if (access === "none") return json({ error: "unauthorized" }, 401);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid_json" }, 400);
        }
        if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);
        const row = body as Record<string, unknown>;
        const op = typeof row.op === "string" ? row.op : "propose";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        try {
          if (op === "list_discrepancies") {
            return json({
              access,
              discrepancies: await listAccountingDiscrepancies(supabaseAdmin),
            });
          }
          if (op === "validate") {
            const actionType = String(row.actionType ?? row.action_type ?? "");
            if (!isAdminActionType(actionType)) return json({ error: "unknown_action" }, 400);
            const validation = await validateProposal(supabaseAdmin, actionType, row.payload);
            return json({ access, validation });
          }
          if (op === "approve" || op === "reject" || op === "commit") {
            if (access !== "owner") {
              return json(
                {
                  error: "owner_required",
                  message: "Approve, reject and commit need owner access.",
                },
                403,
              );
            }
          }
          if (op === "approve" || op === "reject") {
            const proposalId = proposalIdOf(row);
            if (!/^[0-9a-f-]{36}$/i.test(proposalId)) {
              return json({ error: "invalid_proposal" }, 400);
            }
            if (op === "reject") {
              const reason = typeof row.reason === "string" ? row.reason : undefined;
              const proposal = await rejectAdminAction(
                supabaseAdmin,
                proposalId,
                null,
                reason,
                "grok",
              );
              return json({ access, proposal });
            }
            const proposal = await approveAdminAction(supabaseAdmin, proposalId, null, "grok");
            return json({ access, proposal });
          }
          if (op === "commit" || op === "propose") {
            const actionType = String(row.actionType ?? row.action_type ?? "");
            if (!isAdminActionType(actionType)) return json({ error: "unknown_action" }, 400);
            const title = String(row.title ?? actionType);
            const proposal = await proposeAdminAction(supabaseAdmin, {
              actionType,
              title,
              rationale: typeof row.rationale === "string" ? row.rationale : undefined,
              payload: row.payload ?? {},
              proposedBy: typeof row.proposedBy === "string" ? row.proposedBy : "grok",
            });
            if (op === "propose") return json({ access, proposal });
            if (proposal.status !== "validated") return json({ access, proposal }, 422);
            const executed = await approveAdminAction(supabaseAdmin, proposal.id, null, "grok");
            return json({ access, proposal: executed });
          }
          return json({ error: "unknown_op" }, 400);
        } catch (err) {
          const message = err instanceof Error ? err.message : "failed";
          return json({ error: message }, 400);
        }
      },
    },
  },
});
