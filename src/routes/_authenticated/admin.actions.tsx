import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/sign-out";
import { PrimaryButton } from "@/components/field";
import {
  approveAdminActionFn,
  listAdminActionProposals,
  rejectAdminActionFn,
} from "@/lib/admin-actions.functions";

export const Route = createFileRoute("/_authenticated/admin/actions")({
  head: () => ({
    meta: [
      { title: "Handlinger — Gold of Sicily admin" },
      {
        name: "description",
        content: "Approve or reject controlled AI/admin action proposals.",
      },
    ],
  }),
  component: AdminActions,
});

type Proposal = {
  id: string;
  action_type: string;
  title: string;
  rationale: string | null;
  status: string;
  validation: { ok?: boolean; issues?: { code: string; message: string; blocking: boolean }[] };
  result: Record<string, unknown> | null;
  error_message: string | null;
  proposed_by: string;
  created_at: string;
  approved_at: string | null;
  executed_at: string | null;
};

function AdminActions() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const list = useServerFn(listAdminActionProposals);
  const approve = useServerFn(approveAdminActionFn);
  const reject = useServerFn(rejectAdminActionFn);

  const { data, isPending } = useQuery({
    queryKey: ["admin-action-proposals"],
    queryFn: () => list(),
  });

  const approveMutation = useMutation({
    mutationFn: (proposalId: string) => approve({ data: { proposalId } }),
    onSuccess: () => {
      toast.success(t("actions_approved"));
      void queryClient.invalidateQueries({ queryKey: ["admin-action-proposals"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (proposalId: string) =>
      reject({ data: { proposalId, reason: "Rejected in admin UI" } }),
    onSuccess: () => {
      toast.success(t("actions_rejected"));
      void queryClient.invalidateQueries({ queryKey: ["admin-action-proposals"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const proposals = (data?.proposals ?? []) as Proposal[];
  const open = proposals.filter((row) =>
    ["proposed", "validated", "approved", "failed"].includes(row.status),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <p className="eyebrow pt-8">{t("actions_eyebrow")}</p>
      <h1 className="mt-1 text-3xl font-semibold">{t("actions_title")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("actions_intro")}</p>

      <div className="mt-8 space-y-3">
        {isPending ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : open.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("actions_empty")}</p>
        ) : (
          open.map((proposal) => {
            const canDecide =
              proposal.status === "proposed" ||
              proposal.status === "validated" ||
              proposal.status === "failed";
            return (
              <article key={proposal.id} className="surface-card p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {proposal.action_type} · {proposal.status}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold">{proposal.title}</h2>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(proposal.created_at, lang)} · {proposal.proposed_by}
                  </p>
                </div>
                {proposal.rationale ? (
                  <p className="mt-3 text-sm text-muted-foreground">{proposal.rationale}</p>
                ) : null}
                {proposal.validation?.issues && proposal.validation.issues.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-sm">
                    {proposal.validation.issues.map((row) => (
                      <li
                        key={`${row.code}-${row.message}`}
                        className={row.blocking ? "text-destructive" : "text-muted-foreground"}
                      >
                        {row.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {proposal.error_message ? (
                  <p className="mt-3 text-sm text-destructive">{proposal.error_message}</p>
                ) : null}
                {proposal.result ? (
                  <pre className="mt-3 overflow-x-auto rounded-xl bg-muted/40 p-3 text-xs">
                    {JSON.stringify(proposal.result, null, 2)}
                  </pre>
                ) : null}
                {canDecide ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <PrimaryButton
                      type="button"
                      className="w-auto min-h-12 px-6"
                      disabled={!proposal.validation?.ok || approveMutation.isPending}
                      onClick={() => approveMutation.mutate(proposal.id)}
                    >
                      {t("actions_approve")}
                    </PrimaryButton>
                    <button
                      type="button"
                      className="rounded-full border border-border px-4 py-2 text-sm font-medium"
                      disabled={rejectMutation.isPending}
                      onClick={() => rejectMutation.mutate(proposal.id)}
                    >
                      {t("actions_reject")}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      {proposals.some((row) => row.status === "executed" || row.status === "rejected") ? (
        <section className="mt-10">
          <h2 className="eyebrow">{t("actions_history")}</h2>
          <div className="mt-3 space-y-2">
            {proposals
              .filter((row) => row.status === "executed" || row.status === "rejected")
              .slice(0, 20)
              .map((proposal) => (
                <article key={proposal.id} className="rounded-2xl border border-border px-4 py-3">
                  <p className="text-sm font-medium">
                    {proposal.title}{" "}
                    <span className="text-muted-foreground">· {proposal.status}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {proposal.action_type} · {formatDate(proposal.created_at, lang)}
                  </p>
                </article>
              ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
