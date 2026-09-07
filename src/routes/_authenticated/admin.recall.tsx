import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/recall")({
  head: () => ({
    meta: [
      { title: "Tilbakekalling — Gold of Sicily admin" },
      {
        name: "description",
        content: "Search a Gold LOT or supplier LOT and see ingredients and recipients.",
      },
    ],
  }),
  component: AdminRecallRedirect,
});

function AdminRecallRedirect() {
  return <Navigate to="/admin/lots" search={{ tab: "recall" }} replace />;
}
