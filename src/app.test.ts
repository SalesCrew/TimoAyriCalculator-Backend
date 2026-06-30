import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import { fallbackDrinkTypes } from "./services/drink-seed.js";
import {
  type AcceptInvitationResult,
  type AppDataGateway,
  type AppRole,
  type AuthenticatedUser,
  type DrinkEntry,
  type InvitationRequest,
  type LeaderboardRow,
  type ParticipantHistory,
} from "./types.js";

const adminUser: AuthenticatedUser = {
  displayName: "Timo Admin",
  email: "admin@example.com",
  id: "11111111-1111-4111-8111-111111111111",
  role: "admin",
};

const normalUser: AuthenticatedUser = {
  displayName: "Luki",
  email: "luki@example.com",
  id: "22222222-2222-4222-8222-222222222222",
  role: "user",
};

class FakeGateway implements AppDataGateway {
  private readonly tokens = new Map([
    ["admin-token", adminUser],
    ["user-token", normalUser],
  ]);
  private readonly users = new Map([
    [adminUser.id, adminUser],
    [normalUser.id, normalUser],
  ]);
  private readonly invitations = new Map<string, InvitationRequest>();
  private readonly entries: DrinkEntry[] = [];

  async bootstrapAdmin(input: {
    displayName: string;
    email: string;
    password?: string;
  }): Promise<AuthenticatedUser & { temporaryPassword?: string }> {
    const user = {
      displayName: input.displayName,
      email: input.email,
      id: randomUUID(),
      role: "admin" as const,
      temporaryPassword: input.password ? undefined : "TempPass123!",
    };
    this.users.set(user.id, user);
    return user;
  }

  async getUserFromToken(token: string) {
    return this.tokens.get(token) ?? null;
  }

  async listDrinkTypes() {
    return fallbackDrinkTypes;
  }

  async createInvitation(input: {
    displayName: string;
    email: string;
  }): Promise<InvitationRequest> {
    const invitation: InvitationRequest = {
      acceptedAt: null,
      acceptedBy: null,
      createdUserId: null,
      displayName: input.displayName,
      email: input.email.toLocaleLowerCase(),
      id: randomUUID(),
      requestedAt: new Date("2026-06-29T12:00:00.000Z").toISOString(),
      status: "pending",
    };

    this.invitations.set(invitation.id, invitation);
    return invitation;
  }

  async listInvitations() {
    return Array.from(this.invitations.values());
  }

  async acceptInvitation(input: {
    adminUserId: string;
    displayName?: string;
    invitationId: string;
    role: AppRole;
  }): Promise<AcceptInvitationResult> {
    const invitation = this.invitations.get(input.invitationId);

    if (!invitation) {
      throw new Error("not found");
    }

    const user: AuthenticatedUser = {
      displayName: input.displayName ?? invitation.displayName,
      email: invitation.email,
      id: randomUUID(),
      role: input.role,
    };
    const updated: InvitationRequest = {
      ...invitation,
      acceptedAt: new Date("2026-06-29T12:10:00.000Z").toISOString(),
      acceptedBy: input.adminUserId,
      createdUserId: user.id,
      displayName: user.displayName,
      status: "accepted",
    };

    this.users.set(user.id, user);
    this.invitations.set(updated.id, updated);

    return {
      invitation: updated,
      temporaryPassword: "TempPass123!",
      user,
    };
  }

  async rejectInvitation(input: {
    adminUserId: string;
    invitationId: string;
  }): Promise<InvitationRequest> {
    const invitation = this.invitations.get(input.invitationId);

    if (!invitation) {
      throw new Error("not found");
    }

    const updated: InvitationRequest = {
      ...invitation,
      acceptedBy: input.adminUserId,
      status: "rejected",
    };
    this.invitations.set(updated.id, updated);
    return updated;
  }

  async resetUserPassword(input: { userId: string }) {
    return {
      temporaryPassword: "ResetPass123!",
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
    const drink = fallbackDrinkTypes.find((item) => item.id === input.drinkTypeId);

    if (!drink) {
      throw new Error("drink not found");
    }

    const entry: DrinkEntry = {
      abvPercent: drink.abvPercent,
      consumedAt: input.consumedAt ?? "2026-06-29T20:00:00.000Z",
      createdAt: "2026-06-29T20:01:00.000Z",
      drinkName: drink.name,
      drinkTypeId: drink.id,
      id: randomUUID(),
      pureAlcoholMl: Number(
        (input.volumeMl * input.units * (drink.abvPercent / 100)).toFixed(1),
      ),
      units: input.units,
      userDisplayName: this.users.get(input.userId)?.displayName ?? "Unknown",
      userId: input.userId,
      volumeMl: input.volumeMl,
    };

    this.entries.unshift(entry);
    return entry;
  }

  async listActivity(limit: number) {
    return this.entries.slice(0, limit);
  }

  async getLeaderboard(): Promise<LeaderboardRow[]> {
    return Array.from(this.users.values())
      .map((user) => {
        const userEntries = this.entries.filter((entry) => entry.userId === user.id);

        return {
          displayName: user.displayName,
          lastDrink: userEntries[0]?.drinkName ?? null,
          pureAlcoholMl: Number(
            userEntries
              .reduce((total, entry) => total + entry.pureAlcoholMl, 0)
              .toFixed(1),
          ),
          rank: 0,
          role: user.role,
          userId: user.id,
        };
      })
      .sort((first, second) => second.pureAlcoholMl - first.pureAlcoholMl)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  async getParticipantHistory(userId: string): Promise<ParticipantHistory> {
    const user = this.users.get(userId);
    const entries = this.entries.filter((entry) => entry.userId === userId);

    return {
      days: entries.map((entry) => ({
        date: "29.06.",
        entries: entry.units,
        ml: entry.pureAlcoholMl,
      })),
      displayName: user?.displayName ?? "Unknown",
      lastDrink: entries[0]?.drinkName ?? null,
      pureAlcoholMl: entries.reduce(
        (total, entry) => total + entry.pureAlcoholMl,
        0,
      ),
      userId,
    };
  }
}

describe("Ayri backend smoke tests", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({
      gateway: new FakeGateway(),
      logger: false,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns health metadata", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "ayri-leaderboard-api",
      supabaseConfigured: true,
    });
  });

  it("allows Vercel deployment origins through CORS", async () => {
    const origin = "https://timoayricalculator.vercel.app";
    const response = await app.inject({
      headers: {
        "access-control-request-method": "GET",
        origin,
      },
      method: "OPTIONS",
      url: "/v1/drink-types",
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
  });

  it("creates public invitation requests", async () => {
    const response = await app.inject({
      method: "POST",
      payload: {
        displayName: "Max",
        email: "MAX@example.com",
      },
      url: "/v1/invitations",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().invitation).toMatchObject({
      displayName: "Max",
      email: "max@example.com",
      status: "pending",
    });
  });

  it("protects admin routes by token and role", async () => {
    const missingToken = await app.inject({
      method: "GET",
      url: "/v1/admin/invitations",
    });
    const normalUserResponse = await app.inject({
      headers: {
        authorization: "Bearer user-token",
      },
      method: "GET",
      url: "/v1/admin/invitations",
    });

    expect(missingToken.statusCode).toBe(401);
    expect(normalUserResponse.statusCode).toBe(403);
  });

  it("creates the first admin only with the bootstrap token", async () => {
    const bootstrapApp = await buildApp({
      bootstrapAdminToken: "bootstrap-secret",
      gateway: new FakeGateway(),
      logger: false,
    });

    try {
      const rejected = await bootstrapApp.inject({
        headers: {
          "x-bootstrap-token": "wrong",
        },
        method: "POST",
        payload: {
          displayName: "Timo",
          email: "timo@example.com",
          password: "super-secret-123",
        },
        url: "/v1/bootstrap/admin",
      });
      const created = await bootstrapApp.inject({
        headers: {
          "x-bootstrap-token": "bootstrap-secret",
        },
        method: "POST",
        payload: {
          displayName: "Timo",
          email: "timo@example.com",
          password: "super-secret-123",
        },
        url: "/v1/bootstrap/admin",
      });

      expect(rejected.statusCode).toBe(401);
      expect(created.statusCode).toBe(201);
      expect(created.json().user).toMatchObject({
        displayName: "Timo",
        email: "timo@example.com",
        role: "admin",
      });
    } finally {
      await bootstrapApp.close();
    }
  });

  it("lets admins accept invitations and returns a temporary password once", async () => {
    const created = await app.inject({
      method: "POST",
      payload: {
        displayName: "Ben",
        email: "ben@example.com",
      },
      url: "/v1/invitations",
    });
    const invitationId = created.json().invitation.id;

    const accepted = await app.inject({
      headers: {
        authorization: "Bearer admin-token",
      },
      method: "POST",
      payload: {
        role: "user",
      },
      url: `/v1/admin/invitations/${invitationId}/accept`,
    });

    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({
      invitation: {
        status: "accepted",
      },
      user: {
        email: "ben@example.com",
        role: "user",
      },
    });
    expect(accepted.json().temporaryPassword).toHaveLength(12);
  });

  it("submits drinks and recalculates leaderboard state", async () => {
    const drink = fallbackDrinkTypes[0]!;
    const created = await app.inject({
      headers: {
        authorization: "Bearer user-token",
      },
      method: "POST",
      payload: {
        drinkTypeId: drink.id,
        units: 2,
        volumeMl: 500,
      },
      url: "/v1/drink-entries",
    });
    const leaderboard = await app.inject({
      headers: {
        authorization: "Bearer user-token",
      },
      method: "GET",
      url: "/v1/leaderboard",
    });
    const activity = await app.inject({
      headers: {
        authorization: "Bearer user-token",
      },
      method: "GET",
      url: "/v1/activity?limit=10",
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().entry).toMatchObject({
      drinkName: "Märzen Bier",
      pureAlcoholMl: 50,
      units: 2,
      volumeMl: 500,
    });
    expect(leaderboard.json().leaderboard[0]).toMatchObject({
      displayName: "Luki",
      pureAlcoholMl: 50,
    });
    expect(activity.json().activity).toHaveLength(1);
  });
});
