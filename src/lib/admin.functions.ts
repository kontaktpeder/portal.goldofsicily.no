import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseLoginIdentifier, normalizeUsername, usernameToEmail } from "@/lib/username";
import {
  canChangeStaffRole,
  isStaffRole,
  staffCreateSchema,
  type StaffRole,
} from "@/lib/staff";

const createSchema = z.object({
  name: z.string().trim().min(1),
  location: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  partnerId: z.string().uuid().nullable().optional(),
  directPartner: z.boolean().default(false),
  publicVisible: z.boolean().default(false),
  username: z.string().trim().min(3),
  password: z.string().min(6),
  language: z.enum(["no", "en"]).default("no"),
  active: z.boolean().default(true),
});

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function saveProfile(
  supabaseAdmin: AdminClient,
  row: {
    id: string;
    username: string;
    venue_id?: string | null;
    preferred_language?: string;
    full_name?: string | null;
    employee_number?: string | null;
  },
) {
  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", row.id)
    .maybeSingle();

  const patch = {
    username: row.username,
    ...(row.venue_id !== undefined ? { venue_id: row.venue_id } : {}),
    ...(row.preferred_language !== undefined ? { preferred_language: row.preferred_language } : {}),
    ...(row.full_name !== undefined ? { full_name: row.full_name } : {}),
    ...(row.employee_number !== undefined ? { employee_number: row.employee_number } : {}),
  };

  if (existing) {
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", row.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabaseAdmin.from("profiles").insert({ id: row.id, ...patch });
  if (!error) return;
  // Auth trigger may have inserted the row between the select and insert.
  if (error.code === "23505") {
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);
    return;
  }
  throw new Error(error.message);
}

async function assertAdmin(supabase: {
  rpc: (fn: "is_admin") => Promise<{ data: unknown; error: { message: string } | null }>;
}) {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    throw new Error(`Could not verify admin access: ${error.message}`);
  }
  if (data !== true) {
    throw new Error("Not authorized");
  }
}

async function assertOperations(supabase: {
  rpc: (fn: "can_manage_operations") => Promise<{ data: unknown; error: { message: string } | null }>;
}) {
  const { data, error } = await supabase.rpc("can_manage_operations");
  if (error) {
    throw new Error(`Could not verify operations access: ${error.message}`);
  }
  if (data !== true) {
    throw new Error("Not authorized");
  }
}

export const createCustomerAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const login = parseLoginIdentifier(data.username);
    if (!login) {
      throw new Error(
        "Username can only contain letters, numbers, dots, hyphens and underscores (min 3).",
      );
    }
    const { username, email } = login;

    const { data: taken } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (taken) throw new Error("Username is already taken");

    let partnerId = data.partnerId ?? null;
    if (data.directPartner && !partnerId) {
      const { data: partner, error: partnerError } = await supabaseAdmin
        .from("partners")
        .insert({
          name: data.name,
          kind: "direct",
          active: true,
        })
        .select("id")
        .single();
      if (partnerError || !partner) {
        throw new Error(partnerError?.message ?? "Could not create trade partner");
      }
      partnerId = partner.id;
    }

    const city = data.city.trim() || data.location.trim() || null;
    const { data: customer, error: customerError } = await supabaseAdmin
      .from("venues")
      .insert({
        name: data.name,
        location: data.location || city,
        city,
        partner_id: partnerId,
        public_visible: data.publicVisible,
        public_profile: data.directPartner ? "partner" : "listing",
        active: data.active,
        default_language: data.language,
      })
      .select("id")
      .single();
    if (customerError || !customer)
      throw new Error(customerError?.message ?? "Could not create customer");

    let userId: string | undefined;
    try {
      const { data: created, error: userError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: data.password,
        email_confirm: true,
        user_metadata: {
          username,
          venue_id: customer.id,
          customer_id: customer.id,
          language: data.language,
        },
      });
      if (userError || !created?.user) {
        throw new Error(userError?.message ?? "Could not create login");
      }
      userId = created.user.id;

      await saveProfile(supabaseAdmin, {
        id: userId,
        username,
        venue_id: customer.id,
        preferred_language: data.language,
      });

      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: "venue" });
      if (roleError && roleError.code !== "23505") {
        throw new Error(roleError.message);
      }

      return { customerId: customer.id, userId };
    } catch (error) {
      if (userId) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
      }
      await supabaseAdmin.from("venues").delete().eq("id", customer.id);
      throw error instanceof Error ? error : new Error("Could not create customer");
    }
  });

export const resetCustomerPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ userId: z.string().uuid(), password: z.string().min(6) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function countAdmins(supabaseAdmin: AdminClient) {
  const { count, error } = await supabaseAdmin
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export const listStaffAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role, created_at");
    if (roleError) throw new Error(roleError.message);

    const byUser = new Map<string, { role: StaffRole; createdAt: string }>();
    for (const row of roleRows ?? []) {
      if (!isStaffRole(row.role)) continue;
      const existing = byUser.get(row.user_id);
      if (!existing || row.role === "admin") {
        byUser.set(row.user_id, { role: row.role, createdAt: row.created_at });
      }
    }
    const ids = [...byUser.keys()];
    if (ids.length === 0) return { staff: [] as const };

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, username, full_name, employee_number, preferred_language, created_at")
      .in("id", ids);
    if (profileError) throw new Error(profileError.message);

    const staff = (profiles ?? [])
      .map((profile) => {
        const role = byUser.get(profile.id);
        if (!role) return null;
        return {
          id: profile.id,
          username: profile.username,
          fullName: profile.full_name ?? "",
          employeeNumber: profile.employee_number,
          role: role.role,
          preferredLanguage: profile.preferred_language === "en" ? ("en" as const) : ("no" as const),
          createdAt: profile.created_at,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
        return (a.fullName || a.username).localeCompare(b.fullName || b.username);
      });

    return { staff };
  });

export const createStaffAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => staffCreateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const login = parseLoginIdentifier(data.username);
    if (!login) {
      throw new Error(
        "Username can only contain letters, numbers, dots, hyphens and underscores (min 3).",
      );
    }
    const { username, email } = login;

    const { data: taken } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (taken) throw new Error("Username is already taken");

    if (data.employeeNumber) {
      const { data: numberTaken } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("employee_number", data.employeeNumber)
        .maybeSingle();
      if (numberTaken) throw new Error("Employee number is already taken");
    }

    const { data: created, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { username, language: data.language },
    });
    if (userError || !created?.user) {
      throw new Error(userError?.message ?? "Could not create login");
    }
    const userId = created.user.id;

    try {
      await saveProfile(supabaseAdmin, {
        id: userId,
        username,
        venue_id: null,
        preferred_language: data.language,
        full_name: data.fullName,
        employee_number: data.employeeNumber,
      });

      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: data.role });
      if (roleError && roleError.code !== "23505") {
        throw new Error(roleError.message);
      }

      return { userId, username, role: data.role };
    } catch (error) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw error instanceof Error ? error : new Error("Could not create staff account");
    }
  });

/** Read-only Gold production staff for LOT packing. Not a staff-admin listing. */
export const listProductionStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOperations(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role");
    if (roleError) throw new Error(roleError.message);

    const ids = [
      ...new Set(
        (roleRows ?? [])
          .filter((row) => row.role === "admin" || row.role === "ops")
          .map((row) => row.user_id),
      ),
    ];
    if (ids.length === 0) return { staff: [] as const };

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, username, full_name, employee_number")
      .in("id", ids);
    if (profileError) throw new Error(profileError.message);

    const staff = (profiles ?? [])
      .map((profile) => ({
        id: profile.id,
        fullName: profile.full_name ?? "",
        username: profile.username,
        employeeNumber: profile.employee_number,
      }))
      .sort((a, b) => (a.fullName || a.username).localeCompare(b.fullName || b.username));

    return { staff };
  });

export const updateStaffProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        fullName: z.string().trim().min(1),
        employeeNumber: z
          .union([z.string(), z.null(), z.undefined()])
          .optional()
          .transform((value) => {
            const text = (value ?? "").trim();
            return text.length > 0 ? text : null;
          }),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: loadError } = await supabaseAdmin
      .from("profiles")
      .select("id, username")
      .eq("id", data.userId)
      .single();
    if (loadError || !profile) throw new Error(loadError?.message ?? "Not a staff account");
    if (data.employeeNumber) {
      const { data: numberTaken } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("employee_number", data.employeeNumber)
        .neq("id", data.userId)
        .maybeSingle();
      if (numberTaken) throw new Error("Employee number is already taken");
    }
    await saveProfile(supabaseAdmin, {
      id: profile.id,
      username: profile.username,
      full_name: data.fullName,
      employee_number: data.employeeNumber,
    });
    return { ok: true as const };
  });

export const updateStaffRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ userId: z.string().uuid(), role: z.enum(["admin", "ops"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roleRows, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    if (roleError) throw new Error(roleError.message);
    const roles = (roleRows ?? []).map((row) => row.role);
    const currentRole = roles.includes("admin") ? "admin" : roles.includes("ops") ? "ops" : null;
    if (!currentRole) throw new Error("Not a staff account");

    const allowed = canChangeStaffRole({
      currentRole,
      nextRole: data.role,
      adminCount: await countAdmins(supabaseAdmin),
    });
    if (!allowed.ok) {
      throw new Error("Cannot remove the last owner");
    }

    const { error: deleteError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .in("role", ["admin", "ops"]);
    if (deleteError) throw new Error(deleteError.message);

    const { error: insertError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (insertError) throw new Error(insertError.message);

    return { ok: true, role: data.role };
  });

/**
 * One-time bootstrap: creates the very first admin account. Refuses to run once
 * an admin exists, so it can never be used as a public signup.
 */
export const bootstrapFirstAdmin = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ username: z.string().min(3), password: z.string().min(6) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error: countError } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) > 0) throw new Error("An administrator already exists");

    const username = normalizeUsername(data.username);
    const { data: created, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: usernameToEmail(username),
      password: data.password,
      email_confirm: true,
      user_metadata: { username },
    });
    if (userError || !created?.user)
      throw new Error(userError?.message ?? "Could not create admin");

    try {
      await saveProfile(supabaseAdmin, { id: created.user.id, username });
    } catch (error) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw error;
    }
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: created.user.id, role: "admin" });
    if (roleError) throw new Error(roleError.message);
    return { ok: true };
  });

export const adminExists = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  return { exists: (count ?? 0) > 0 };
});
