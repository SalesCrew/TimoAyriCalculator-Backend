import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

import { ApiError } from "../errors.js";
import { env, hasSupabaseConfig } from "../env.js";
import {
  type AcceptInvitationResult,
  type AppDataGateway,
  type AppRole,
  type AuthenticatedUser,
  type DrinkEntry,
  type DrinkType,
  type InvitationRequest,
  type LeaderboardRow,
  type ParticipantHistory,
} from "../types.js";
import { fallbackDrinkTypes } from "./drink-seed.js";
import { generateTemporaryPassword } from "./password.js";

type SupabaseOptions = NonNullable<Parameters<typeof createClient>[2]>;
type RealtimeOptions = NonNullable<SupabaseOptions["realtime"]>;

const nodeWebSocket = ws as unknown as RealtimeOptions["transport"];

type DbProfile = {
  display_name: string;
  id: string;
  role: AppRole;
};

type DbDrinkType = {
  abv_percent: number | string;
  category: string | null;
  id: string;
  is_active: boolean;
  name: string;
};

type DbInvitationRequest = {
  accepted_at: string | null;
  accepted_by: string | null;
  created_user_id: string | null;
  display_name: string;
  email: string;
  id: string;
  requested_at: string;
  status: "accepted" | "pending" | "rejected";
};

type DbDrinkEntry = {
  abv_percent: number | string;
  consumed_at: string;
  created_at: string;
  drink_name_snapshot: string;
  drink_type_id: string | null;
  drink_volume_ml: number | string;
  id: string;
  pure_alcohol_ml: number | string;
  units: number;
  user_id: string;
};

function toNumber(value: number | string) {
  return typeof value === "number" ? value : Number(value);
}

function toDrinkType(row: DbDrinkType): DrinkType {
  return {
    abvPercent: toNumber(row.abv_percent),
    category: row.category ?? "other",
    id: row.id,
    isActive: row.is_active,
    name: row.name,
  };
}

function toInvitation(row: DbInvitationRequest): InvitationRequest {
  return {
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    createdUserId: row.created_user_id,
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    requestedAt: row.requested_at,
    status: row.status,
  };
}

function toDrinkEntry(
  row: DbDrinkEntry,
  displayNameByUserId: Map<string, string>,
): DrinkEntry {
  return {
    abvPercent: toNumber(row.abv_percent),
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    drinkName: row.drink_name_snapshot,
    drinkTypeId: row.drink_type_id,
    id: row.id,
    pureAlcoholMl: toNumber(row.pure_alcohol_ml),
    units: row.units,
    userDisplayName: displayNameByUserId.get(row.user_id) ?? "Unknown",
    userId: row.user_id,
    volumeMl: toNumber(row.drink_volume_ml),
  };
}

function getRole(value: unknown): AppRole {
  return value === "admin" ? "admin" : "user";
}

function getDisplayName(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return fallback;
}

function normalizeEmail(email: string) {
  return email.trim().toLocaleLowerCase();
}

function localDateKey(value: string) {
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Vienna",
  }).format(new Date(value));
}

export class SupabaseGateway implements AppDataGateway {
  constructor(private readonly supabase: SupabaseClient) {}

  async bootstrapAdmin(input: {
    displayName: string;
    email: string;
    password?: string;
  }): Promise<AuthenticatedUser & { temporaryPassword?: string }> {
    const temporaryPassword = input.password ? undefined : generateTemporaryPassword();
    const password = input.password ?? temporaryPassword!;
    const { data: created, error: createError } =
      await this.supabase.auth.admin.createUser({
        app_metadata: {
          role: "admin",
        },
        email: normalizeEmail(input.email),
        email_confirm: true,
        password,
        user_metadata: {
          display_name: input.displayName.trim(),
        },
      });

    if (createError || !created.user?.email) {
      throw new ApiError(
        createError?.status === 422 ? 409 : 500,
        createError?.message ?? "Could not create admin user",
        "admin_create_failed",
      );
    }

    try {
      const { error: profileError } = await this.supabase.from("profiles").insert({
        display_name: input.displayName.trim(),
        id: created.user.id,
        role: "admin",
      });

      if (profileError) {
        throw profileError;
      }
    } catch (error) {
      await this.supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
      throw new ApiError(500, "Could not create admin profile", "admin_profile_failed");
    }

    return {
      displayName: input.displayName.trim(),
      email: created.user.email,
      id: created.user.id,
      role: "admin",
      temporaryPassword,
    };
  }

  async getUserFromToken(token: string): Promise<AuthenticatedUser | null> {
    const { data, error } = await this.supabase.auth.getUser(token);

    if (error || !data.user?.email) {
      return null;
    }

    const { data: profile } = await this.supabase
      .from("profiles")
      .select("id, display_name, role")
      .eq("id", data.user.id)
      .maybeSingle<DbProfile>();

    const displayName = getDisplayName(
      profile?.display_name ?? data.user.user_metadata?.display_name,
      data.user.email,
    );

    return {
      displayName,
      email: data.user.email,
      id: data.user.id,
      role: getRole(profile?.role ?? data.user.app_metadata?.role),
    };
  }

  async listDrinkTypes(): Promise<DrinkType[]> {
    const { data, error } = await this.supabase
      .from("drink_types")
      .select("id, name, abv_percent, category, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      throw new ApiError(500, "Could not load drink types", "drink_load_failed");
    }

    if (!data?.length) {
      return fallbackDrinkTypes;
    }

    return data.map((row) => toDrinkType(row as DbDrinkType));
  }

  async createInvitation(input: {
    displayName: string;
    email: string;
  }): Promise<InvitationRequest> {
    const { data, error } = await this.supabase
      .from("invitation_requests")
      .insert({
        display_name: input.displayName.trim(),
        email: normalizeEmail(input.email),
      })
      .select("*")
      .single<DbInvitationRequest>();

    if (error) {
      const isDuplicate = error.code === "23505";
      throw new ApiError(
        isDuplicate ? 409 : 500,
        isDuplicate
          ? "Invitation already exists for this email"
          : "Could not create invitation",
        isDuplicate ? "invitation_exists" : "invitation_create_failed",
      );
    }

    return toInvitation(data);
  }

  async listInvitations(): Promise<InvitationRequest[]> {
    const { data, error } = await this.supabase
      .from("invitation_requests")
      .select("*")
      .order("requested_at", { ascending: false });

    if (error) {
      throw new ApiError(500, "Could not load invitations", "invitation_load_failed");
    }

    return (data ?? []).map((row) => toInvitation(row as DbInvitationRequest));
  }

  async acceptInvitation(input: {
    adminUserId: string;
    displayName?: string;
    invitationId: string;
    role: AppRole;
  }): Promise<AcceptInvitationResult> {
    const invitation = await this.getInvitationById(input.invitationId);

    if (invitation.status !== "pending") {
      throw new ApiError(409, "Invitation is not pending", "invitation_not_pending");
    }

    const displayName = input.displayName?.trim() || invitation.displayName;
    const temporaryPassword = generateTemporaryPassword();
    const { data: created, error: createError } =
      await this.supabase.auth.admin.createUser({
        app_metadata: {
          role: input.role,
        },
        email: invitation.email,
        email_confirm: true,
        password: temporaryPassword,
        user_metadata: {
          display_name: displayName,
        },
      });

    if (createError || !created.user?.email) {
      throw new ApiError(
        createError?.status === 422 ? 409 : 500,
        createError?.message ?? "Could not create Supabase user",
        "user_create_failed",
      );
    }

    try {
      const { error: profileError } = await this.supabase.from("profiles").insert({
        display_name: displayName,
        id: created.user.id,
        role: input.role,
      });

      if (profileError) {
        throw profileError;
      }

      const { data: updatedInvitation, error: updateError } = await this.supabase
        .from("invitation_requests")
        .update({
          accepted_at: new Date().toISOString(),
          accepted_by: input.adminUserId,
          created_user_id: created.user.id,
          display_name: displayName,
          status: "accepted",
        })
        .eq("id", invitation.id)
        .eq("status", "pending")
        .select("*")
        .single<DbInvitationRequest>();

      if (updateError) {
        throw updateError;
      }

      return {
        invitation: toInvitation(updatedInvitation),
        temporaryPassword,
        user: {
          displayName,
          email: created.user.email,
          id: created.user.id,
          role: input.role,
        },
      };
    } catch (error) {
      await this.supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
      throw new ApiError(500, "Could not accept invitation", "invitation_accept_failed");
    }
  }

  async rejectInvitation(input: {
    adminUserId: string;
    invitationId: string;
  }): Promise<InvitationRequest> {
    const { data, error } = await this.supabase
      .from("invitation_requests")
      .update({
        accepted_by: input.adminUserId,
        status: "rejected",
      })
      .eq("id", input.invitationId)
      .eq("status", "pending")
      .select("*")
      .single<DbInvitationRequest>();

    if (error) {
      throw new ApiError(404, "Pending invitation not found", "invitation_not_found");
    }

    return toInvitation(data);
  }

  async resetUserPassword(input: {
    userId: string;
  }): Promise<{ temporaryPassword: string; userId: string }> {
    const temporaryPassword = generateTemporaryPassword();
    const { error } = await this.supabase.auth.admin.updateUserById(
      input.userId,
      {
        password: temporaryPassword,
      },
    );

    if (error) {
      throw new ApiError(500, "Could not reset password", "password_reset_failed");
    }

    return {
      temporaryPassword,
      userId: input.userId,
    };
  }

  async createDrinkEntry(input: {
    consumedAt?: string;
    drinkTypeId: string;
    units: number;
    userId: string;
    volumeMl: number;
  }): Promise<DrinkEntry> {
    const drinkType = await this.getDrinkTypeById(input.drinkTypeId);
    const pureAlcoholMl = Number(
      (input.volumeMl * input.units * (drinkType.abvPercent / 100)).toFixed(1),
    );

    const { data, error } = await this.supabase
      .from("drink_entries")
      .insert({
        abv_percent: drinkType.abvPercent,
        consumed_at: input.consumedAt ?? new Date().toISOString(),
        drink_name_snapshot: drinkType.name,
        drink_type_id: drinkType.id,
        drink_volume_ml: input.volumeMl,
        pure_alcohol_ml: pureAlcoholMl,
        units: input.units,
        user_id: input.userId,
      })
      .select("*")
      .single<DbDrinkEntry>();

    if (error) {
      throw new ApiError(500, "Could not submit drink", "drink_submit_failed");
    }

    const profiles = await this.getProfilesByIds([input.userId]);
    return toDrinkEntry(data, profiles);
  }

  async listActivity(limit: number): Promise<DrinkEntry[]> {
    const { data, error } = await this.supabase
      .from("drink_entries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new ApiError(500, "Could not load activity", "activity_load_failed");
    }

    const entries = (data ?? []) as DbDrinkEntry[];
    const profiles = await this.getProfilesByIds(
      Array.from(new Set(entries.map((entry) => entry.user_id))),
    );

    return entries.map((entry) => toDrinkEntry(entry, profiles));
  }

  async getLeaderboard(): Promise<LeaderboardRow[]> {
    const [profiles, entries] = await Promise.all([
      this.getProfiles(),
      this.getDrinkEntries(),
    ]);

    const totals = new Map<
      string,
      { lastDrink: string | null; lastTime: string | null; total: number }
    >();

    for (const profile of profiles) {
      totals.set(profile.id, {
        lastDrink: null,
        lastTime: null,
        total: 0,
      });
    }

    for (const entry of entries) {
      const current =
        totals.get(entry.user_id) ??
        ({
          lastDrink: null,
          lastTime: null,
          total: 0,
        } satisfies { lastDrink: string | null; lastTime: string | null; total: number });

      current.total += toNumber(entry.pure_alcohol_ml);

      if (!current.lastTime || entry.consumed_at > current.lastTime) {
        current.lastDrink = entry.drink_name_snapshot;
        current.lastTime = entry.consumed_at;
      }

      totals.set(entry.user_id, current);
    }

    return profiles
      .map((profile) => ({
        displayName: profile.display_name,
        lastDrink: totals.get(profile.id)?.lastDrink ?? null,
        pureAlcoholMl: Number((totals.get(profile.id)?.total ?? 0).toFixed(1)),
        rank: 0,
        role: profile.role,
        userId: profile.id,
      }))
      .sort((first, second) => second.pureAlcoholMl - first.pureAlcoholMl)
      .map((row, index) => ({
        ...row,
        rank: index + 1,
      }));
  }

  async getParticipantHistory(userId: string): Promise<ParticipantHistory> {
    const { data: profile, error: profileError } = await this.supabase
      .from("profiles")
      .select("id, display_name, role")
      .eq("id", userId)
      .single<DbProfile>();

    if (profileError) {
      throw new ApiError(404, "Participant not found", "participant_not_found");
    }

    const { data, error } = await this.supabase
      .from("drink_entries")
      .select("*")
      .eq("user_id", userId)
      .order("consumed_at", { ascending: true });

    if (error) {
      throw new ApiError(500, "Could not load history", "history_load_failed");
    }

    const byDate = new Map<string, { entries: number; ml: number }>();
    let total = 0;
    let lastDrink: string | null = null;

    for (const entry of (data ?? []) as DbDrinkEntry[]) {
      const key = localDateKey(entry.consumed_at);
      const current = byDate.get(key) ?? { entries: 0, ml: 0 };
      current.entries += entry.units;
      current.ml += toNumber(entry.pure_alcohol_ml);
      byDate.set(key, current);
      total += toNumber(entry.pure_alcohol_ml);
      lastDrink = entry.drink_name_snapshot;
    }

    return {
      days: Array.from(byDate.entries()).map(([date, value]) => ({
        date,
        entries: value.entries,
        ml: Number(value.ml.toFixed(1)),
      })),
      displayName: profile.display_name,
      lastDrink,
      pureAlcoholMl: Number(total.toFixed(1)),
      userId: profile.id,
    };
  }

  private async getInvitationById(id: string) {
    const { data, error } = await this.supabase
      .from("invitation_requests")
      .select("*")
      .eq("id", id)
      .single<DbInvitationRequest>();

    if (error) {
      throw new ApiError(404, "Invitation not found", "invitation_not_found");
    }

    return toInvitation(data);
  }

  private async getDrinkTypeById(id: string) {
    const { data, error } = await this.supabase
      .from("drink_types")
      .select("id, name, abv_percent, category, is_active")
      .eq("id", id)
      .eq("is_active", true)
      .single<DbDrinkType>();

    if (error) {
      throw new ApiError(404, "Drink type not found", "drink_type_not_found");
    }

    return toDrinkType(data);
  }

  private async getProfiles() {
    const { data, error } = await this.supabase
      .from("profiles")
      .select("id, display_name, role")
      .order("display_name", { ascending: true });

    if (error) {
      throw new ApiError(500, "Could not load profiles", "profile_load_failed");
    }

    return (data ?? []) as DbProfile[];
  }

  private async getProfilesByIds(userIds: string[]) {
    if (userIds.length === 0) {
      return new Map<string, string>();
    }

    const { data, error } = await this.supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);

    if (error) {
      throw new ApiError(500, "Could not load profiles", "profile_load_failed");
    }

    return new Map(
      ((data ?? []) as DbProfile[]).map((profile) => [
        profile.id,
        profile.display_name,
      ]),
    );
  }

  private async getDrinkEntries() {
    const { data, error } = await this.supabase
      .from("drink_entries")
      .select("*")
      .order("consumed_at", { ascending: true });

    if (error) {
      throw new ApiError(500, "Could not load entries", "entry_load_failed");
    }

    return (data ?? []) as DbDrinkEntry[];
  }
}

export function createSupabaseGateway() {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseSecretKey = env.SUPABASE_SECRET_KEY;

  if (!hasSupabaseConfig || !supabaseUrl || !supabaseSecretKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: nodeWebSocket,
    },
  });

  return new SupabaseGateway(supabase);
}
