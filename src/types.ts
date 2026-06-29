import type { FastifyRequest } from "fastify";

export type AppRole = "admin" | "user";

export type AuthenticatedUser = {
  displayName: string;
  email: string;
  id: string;
  role: AppRole;
};

export type DrinkType = {
  abvPercent: number;
  category: string;
  id: string;
  isActive: boolean;
  name: string;
};

export type InvitationStatus = "accepted" | "pending" | "rejected";

export type InvitationRequest = {
  acceptedAt: string | null;
  acceptedBy: string | null;
  createdUserId: string | null;
  displayName: string;
  email: string;
  id: string;
  requestedAt: string;
  status: InvitationStatus;
};

export type DrinkEntry = {
  abvPercent: number;
  consumedAt: string;
  createdAt: string;
  drinkName: string;
  drinkTypeId: string | null;
  id: string;
  pureAlcoholMl: number;
  units: number;
  userDisplayName: string;
  userId: string;
  volumeMl: number;
};

export type LeaderboardRow = {
  displayName: string;
  lastDrink: string | null;
  pureAlcoholMl: number;
  rank: number;
  role: AppRole;
  userId: string;
};

export type ParticipantDay = {
  date: string;
  entries: number;
  ml: number;
};

export type ParticipantHistory = {
  days: ParticipantDay[];
  displayName: string;
  lastDrink: string | null;
  pureAlcoholMl: number;
  userId: string;
};

export type AcceptInvitationResult = {
  invitation: InvitationRequest;
  temporaryPassword: string;
  user: AuthenticatedUser;
};

export type AppDataGateway = {
  acceptInvitation(input: {
    adminUserId: string;
    displayName?: string;
    invitationId: string;
    role: AppRole;
  }): Promise<AcceptInvitationResult>;
  bootstrapAdmin(input: {
    displayName: string;
    email: string;
    password?: string;
  }): Promise<AcceptInvitationResult["user"] & { temporaryPassword?: string }>;
  createDrinkEntry(input: {
    consumedAt?: string;
    drinkTypeId: string;
    units: number;
    userId: string;
    volumeMl: number;
  }): Promise<DrinkEntry>;
  createInvitation(input: {
    displayName: string;
    email: string;
  }): Promise<InvitationRequest>;
  getLeaderboard(): Promise<LeaderboardRow[]>;
  getParticipantHistory(userId: string): Promise<ParticipantHistory>;
  getUserFromToken(token: string): Promise<AuthenticatedUser | null>;
  listActivity(limit: number): Promise<DrinkEntry[]>;
  listDrinkTypes(): Promise<DrinkType[]>;
  listInvitations(): Promise<InvitationRequest[]>;
  rejectInvitation(input: {
    adminUserId: string;
    invitationId: string;
  }): Promise<InvitationRequest>;
  resetUserPassword(input: {
    userId: string;
  }): Promise<{ temporaryPassword: string; userId: string }>;
};

export type AuthenticatedRequest = FastifyRequest & {
  user: AuthenticatedUser;
};
