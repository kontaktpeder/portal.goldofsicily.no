import { createFileRoute } from "@tanstack/react-router";
import { isAdminActionType } from "@/lib/admin-actions";
import {
  listAccountingDiscrepancies,
  proposeAdminAction,
  validateProposal,
} from "@/lib/admin-actions.server";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function authorized(request: Request): boolean {
  const expected = process.env["ADMIN_ACTIONS_TOKEN"];
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  return header.slice("Bearer ".length) === expected;
}

export const Route = createFileRoute("/api/admin/v1/actions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorized(request)) return json({ error: "unauthorized" }, 401);
        const url = new URL(request.url);
        const view = url.searchParams.get("view");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (view === "discrepancies") {
          return json({ discrepancies: await listAccountingDiscrepancies(supabaseAdmin) });
        }
        const { data, error } = await supabaseAdmin
          .from("admin_action_proposals")
          .select(
            "id, action_type, title, rationale, status, validation, result, error_message, proposed_by, created_at, approved_at, executed_at",
          )
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) return json({ error: error.message }, 500);
        return json({ proposals: data ?? [] });
      },
      POST: async ({ request }) => {
        if (!authorized(request)) return json({ error: "unauthorized" }, 401);
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
            return json({ discrepancies: await listAccountingDiscrepancies(supabaseAdmin) });
          }
          if (op === "validate") {
            const actionType = String(row.actionType ?? row.action_type ?? "");
            if (!isAdminActionType(actionType)) return json({ error: "unknown_action" }, 400);
            const validation = await validateProposal(supabaseAdmin, actionType, row.payload);
            return json({ validation });
          }
          if (op === "approve" || op === "reject") {
            return json(
              {
                error: "approval_requires_human",
                message: "Approve/reject only in the portal UI (/admin/actions).",
              },
              403,
            );
          }

          // default: propose
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
          return json({ proposal });
        } catch (err) {
          const message = err instanceof Error ? err.message : "failed";
          return json({ error: message }, 400);
        }
      },
    },
  },
});
