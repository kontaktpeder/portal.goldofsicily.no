import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { adminExists, bootstrapFirstAdmin } from "@/lib/admin.functions";
import { errorMessage } from "@/lib/utils";
import { Wordmark } from "@/components/brand";
import { PrimaryButton, TextField } from "@/components/field";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "Administrator setup — Gold of Sicily" },
      {
        name: "description",
        content: "One-time creation of the first Gold of Sicily administrator account.",
      },
      { property: "og:title", content: "Administrator setup — Gold of Sicily" },
      {
        property: "og:description",
        content: "One-time creation of the first Gold of Sicily administrator account.",
      },
    ],
  }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const checkAdmin = useServerFn(adminExists);
  const createAdmin = useServerFn(bootstrapFirstAdmin);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-exists"],
    queryFn: () => checkAdmin(),
  });

  async function handleCreate() {
    if (username.trim().length < 3 || password.length < 6) {
      toast.error("Username min 3 characters, password min 6 characters.");
      return;
    }
    setBusy(true);
    try {
      await createAdmin({ data: { username, password } });
      toast.success("Administrator created. You can sign in now.");
      await refetch();
      void navigate({ to: "/", replace: true });
    } catch (error) {
      toast.error(errorMessage(error, "Could not create administrator"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <Wordmark size="lg" />
        <h1 className="mt-10 text-3xl font-semibold">Administrator setup</h1>

        {isLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Checking …</p>
        ) : data?.exists ? (
          <p className="mt-6 rounded-2xl bg-muted px-4 py-4 text-sm text-muted-foreground">
            An administrator already exists. Customer accounts are created from the admin area —
            there is no public signup.
          </p>
        ) : (
          <div className="mt-8 space-y-4">
            <p className="text-sm text-muted-foreground">
              Create the first administrator account. This page locks itself afterwards.
            </p>
            <TextField label="Username" value={username} onChange={setUsername} />
            <TextField label="Password" value={password} onChange={setPassword} type="password" />
            <PrimaryButton onClick={handleCreate} disabled={busy}>
              {busy ? "Creating …" : "Create administrator"}
            </PrimaryButton>
          </div>
        )}
      </div>
    </main>
  );
}
