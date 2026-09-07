import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useSessionInfo } from "@/hooks/use-session";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  createStaffAccount,
  listStaffAccounts,
  resetCustomerPassword,
  updateStaffProfile,
  updateStaffRole,
} from "@/lib/admin.functions";
import {
  isStaffSchemaError,
  OPS_INCLUDE_KEYS,
  OWNER_INCLUDE_KEYS,
  VENUE_INCLUDE_KEYS,
  type StaffRole,
} from "@/lib/staff";
import { isProducerSchemaError } from "@/lib/lot-producers";
import { isValidUsername, parseLoginIdentifier } from "@/lib/username";
import { errorMessage } from "@/lib/utils";
import { PrimaryButton, TextField } from "@/components/field";

export const Route = createFileRoute("/_authenticated/admin/staff")({
  head: () => ({
    meta: [
      { title: "Ansatte — Gold of Sicily" },
      {
        name: "description",
        content: "Create Gold employee logins and choose owner or ops access. No email is sent.",
      },
    ],
  }),
  component: AdminStaff,
});

function AdminStaff() {
  const { t } = useI18n();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const { data: info, isLoading: sessionLoading } = useSessionInfo();
  const listStaff = useServerFn(listStaffAccounts);
  const createStaff = useServerFn(createStaffAccount);

  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("ops");
  const [busy, setBusy] = useState(false);
  const loginPreview = parseLoginIdentifier(username)?.username;

  useEffect(() => {
    if (!sessionLoading && info && !info.canManageCommercial) {
      void navigate({ to: "/admin", replace: true });
    }
  }, [info, navigate, sessionLoading]);

  const { data, error: loadError } = useQuery({
    queryKey: ["staff-accounts"],
    enabled: Boolean(info?.canManageCommercial),
    queryFn: () => listStaff(),
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!fullName.trim()) {
      toast.error(t("staff_name_missing"));
      return;
    }
    if (!username.trim() || password.length < 6) {
      toast.error(t("staff_missing"));
      return;
    }
    if (!isValidUsername(username)) {
      toast.error(t("create_customer_username"));
      return;
    }
    setBusy(true);
    try {
      const created = await createStaff({
        data: {
          fullName,
          username,
          password,
          role,
          language: "no",
          employeeNumber,
        },
      });
      toast.success(`${created.username} ${t("staff_created")}`);
      setOpen(false);
      setFullName("");
      setUsername("");
      setEmployeeNumber("");
      setPassword("");
      setRole("ops");
      await queryClient.invalidateQueries({ queryKey: ["staff-accounts"] });
    } catch (error) {
      const message = errorMessage(error, t("staff_failed"));
      const lower = message.toLowerCase();
      if (isStaffSchemaError(message)) {
        toast.error(t("staff_schema_missing"));
      } else if (lower.includes("already") || lower.includes("opptatt") || lower.includes("taken")) {
        toast.error(t("create_customer_username_taken"));
      } else if (lower.includes("employee number") || lower.includes("ansattnummer")) {
        toast.error(t("employee_number_taken"));
      } else if (
        lower.includes("weak") ||
        lower.includes("pwned") ||
        lower.includes("easy to guess")
      ) {
        toast.error(t("create_customer_weak_password"));
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (sessionLoading || !info?.canManageCommercial) {
    return <main className="min-h-screen" />;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex items-center justify-between gap-3 pt-8">
        <div>
          <h1 className="text-3xl font-semibold">{t("staff_title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("staff_intro")}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" />
          {t("new_staff")}
        </button>
      </div>

      {open ? (
        <form className="surface-card mt-5 space-y-5 p-5" onSubmit={submit}>
          <p className="text-sm text-muted-foreground">{t("staff_no_email")}</p>
          <TextField label={t("full_name")} value={fullName} onChange={setFullName} />
          <div>
            <TextField label={t("username")} value={username} onChange={setUsername} />
            {loginPreview && loginPreview !== username.trim().toLowerCase() ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("create_customer_login_as")}: <strong>{loginPreview}</strong>
              </p>
            ) : null}
          </div>
          <div>
            <TextField label={t("employee_number")} value={employeeNumber} onChange={setEmployeeNumber} />
            <p className="mt-2 text-xs text-muted-foreground">{t("employee_number_hint")}</p>
          </div>
          <TextField
            label={t("password")}
            value={password}
            onChange={setPassword}
            type="password"
          />
          <fieldset>
            <legend className="eyebrow mb-3 block">{t("staff_choose_role")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <RoleCard
                selected={role === "admin"}
                title={t("role_owner")}
                includes={OWNER_INCLUDE_KEYS}
                onSelect={() => setRole("admin")}
              />
              <RoleCard
                selected={role === "ops"}
                title={t("role_ops")}
                includes={OPS_INCLUDE_KEYS}
                onSelect={() => setRole("ops")}
              />
            </div>
            <div className="mt-3 rounded-2xl border border-dashed border-border px-4 py-3">
              <p className="text-sm font-semibold text-muted-foreground">{t("role_venue")}</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {VENUE_INCLUDE_KEYS.map((key) => (
                  <li key={key}>· {t(key)}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("role_venue_hint")}{" "}
                <Link to="/admin/venues" className="underline underline-offset-2">
                  {t("nav_venues")}
                </Link>
              </p>
            </div>
          </fieldset>
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "…" : t("create")}
          </PrimaryButton>
        </form>
      ) : null}

      <div className="mt-6 space-y-3">
        {loadError ? (
          <p className="text-sm text-destructive">
            {isProducerSchemaError(loadError)
              ? t("producer_schema_missing")
              : errorMessage(loadError, t("staff_failed"))}
          </p>
        ) : (data?.staff ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_staff")}</p>
        ) : (
          data?.staff.map((person) => (
            <StaffRow
              key={person.id}
              person={person}
              isYou={person.id === info.session?.user.id}
              adminCount={data.staff.filter((row) => row.role === "admin").length}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["staff-accounts"] })}
            />
          ))
        )}
      </div>
    </main>
  );
}

function RoleCard({
  selected,
  title,
  includes,
  onSelect,
}: {
  selected: boolean;
  title: string;
  includes: readonly TranslationKey[];
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-2xl border-2 px-4 py-4 text-left transition-colors ${
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card hover:border-primary/60"
      }`}
    >
      <p className="text-base font-semibold">{title}</p>
      <ul className={`mt-2 space-y-1 text-sm ${selected ? "text-primary-foreground/85" : "text-muted-foreground"}`}>
        {includes.map((key) => (
          <li key={key}>· {t(key)}</li>
        ))}
      </ul>
    </button>
  );
}

function StaffRow({
  person,
  isYou,
  adminCount,
  onChanged,
}: {
  person: {
    id: string;
    username: string;
    fullName: string;
    employeeNumber: string | null;
    role: StaffRole;
    preferredLanguage: "no" | "en";
  };
  isYou: boolean;
  adminCount: number;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const resetPassword = useServerFn(resetCustomerPassword);
  const changeRole = useServerFn(updateStaffRole);
  const saveProfile = useServerFn(updateStaffProfile);
  const [fullName, setFullName] = useState(person.fullName);
  const [employeeNumber, setEmployeeNumber] = useState(person.employeeNumber ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const lastOwner = person.role === "admin" && adminCount <= 1;

  useEffect(() => {
    setFullName(person.fullName);
    setEmployeeNumber(person.employeeNumber ?? "");
  }, [person.fullName, person.employeeNumber]);

  async function saveName() {
    if (!fullName.trim()) {
      toast.error(t("staff_name_missing"));
      return;
    }
    setBusy(true);
    try {
      await saveProfile({
        data: { userId: person.id, fullName, employeeNumber },
      });
      toast.success(t("staff_updated"));
      onChanged();
    } catch (error) {
      const message = errorMessage(error, t("staff_failed"));
      if (message.toLowerCase().includes("employee number") || message.toLowerCase().includes("duplicate")) {
        toast.error(t("employee_number_taken"));
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (password.length < 6) {
      toast.error(t("staff_missing"));
      return;
    }
    setBusy(true);
    try {
      await resetPassword({ data: { userId: person.id, password } });
      toast.success(t("reset_password"));
      setPassword("");
    } catch (error) {
      toast.error(errorMessage(error, t("staff_failed")));
    } finally {
      setBusy(false);
    }
  }

  async function saveRole(next: StaffRole) {
    if (next === person.role) return;
    if (person.role === "admin" && next !== "admin" && lastOwner) {
      toast.error(t("staff_last_admin"));
      return;
    }
    setBusy(true);
    try {
      await changeRole({ data: { userId: person.id, role: next } });
      toast.success(t("staff_role_updated"));
      onChanged();
    } catch (error) {
      const message = errorMessage(error, t("staff_failed"));
      if (message.toLowerCase().includes("last owner") || message.toLowerCase().includes("siste")) {
        toast.error(t("staff_last_admin"));
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-card space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-lg font-semibold">{person.fullName || person.username}</p>
          <p className="text-xs text-muted-foreground">
            {person.username}
            {person.employeeNumber ? ` · ${person.employeeNumber}` : ""}
            {` · ${person.role === "admin" ? t("role_owner") : t("role_ops")}`}
            {isYou ? ` · ${t("this_is_you")}` : ""}
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t("full_name")} value={fullName} onChange={setFullName} />
        <div>
          <TextField label={t("employee_number")} value={employeeNumber} onChange={setEmployeeNumber} />
        </div>
      </div>
      <PrimaryButton onClick={() => void saveName()} disabled={busy}>
        {t("save")}
      </PrimaryButton>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveRole("admin")}
          className={`rounded-2xl border-2 px-3 py-3 text-left text-sm ${
            person.role === "admin"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground"
          }`}
        >
          <span className="font-semibold">{t("role_owner")}</span>
        </button>
        <button
          type="button"
          disabled={busy || lastOwner}
          onClick={() => void saveRole("ops")}
          className={`rounded-2xl border-2 px-3 py-3 text-left text-sm disabled:opacity-50 ${
            person.role === "ops"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground"
          }`}
        >
          <span className="font-semibold">{t("role_ops")}</span>
        </button>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <TextField
            label={t("new_password")}
            value={password}
            onChange={setPassword}
            type="password"
          />
        </div>
        <PrimaryButton onClick={() => void savePassword()} disabled={busy || !password}>
          {t("reset_password")}
        </PrimaryButton>
      </div>
    </section>
  );
}
