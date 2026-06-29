import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError, type ZodType } from "zod";

import { ApiError, isApiError } from "./errors.js";
import { allowedOrigins, env } from "./env.js";
import { createSupabaseGateway } from "./services/supabase-gateway.js";
import {
  type AppDataGateway,
  type AuthenticatedRequest,
  type AuthenticatedUser,
} from "./types.js";

type BuildAppOptions = {
  bootstrapAdminToken?: string;
  gateway?: AppDataGateway | null;
  logger?: boolean;
};

const invitationSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160),
});

const drinkEntrySchema = z.object({
  consumedAt: z.string().datetime().optional(),
  drinkTypeId: z.string().min(1),
  units: z.coerce.number().int().min(1).max(50),
  volumeMl: z.coerce.number().int().min(1).max(5_000),
});

const acceptInvitationSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  role: z.enum(["admin", "user"]).default("user"),
});

const bootstrapAdminSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160),
  password: z.string().min(10).max(120).optional(),
});

const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const invitationParamsSchema = z.object({
  invitationId: z.string().uuid(),
});

const userParamsSchema = z.object({
  userId: z.string().uuid(),
});

function parseWith<T>(schema: ZodType<T>, value: unknown) {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(400, "Invalid request payload", "validation_failed");
    }

    throw error;
  }
}

function getBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

function serializeUser(user: AuthenticatedUser) {
  return {
    displayName: user.displayName,
    email: user.email,
    id: user.id,
    role: user.role,
  };
}

export async function buildApp(options: BuildAppOptions = {}) {
  const gateway = options.gateway ?? createSupabaseGateway();
  const bootstrapAdminToken =
    options.bootstrapAdminToken ?? env.BOOTSTRAP_ADMIN_TOKEN;
  const app = Fastify({
    logger:
      options.logger ??
      (env.NODE_ENV === "production"
        ? { level: "info" }
        : { level: "debug" }),
  });

  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed"), false);
    },
  });

  app.setErrorHandler((error, _request, reply) => {
    if (isApiError(error)) {
      reply.status(error.statusCode).send({
        code: error.code,
        error: error.message,
      });
      return;
    }

    app.log.error(error);
    reply.status(500).send({
      code: "internal_server_error",
      error: "Internal server error",
    });
  });

  function getGateway() {
    if (!gateway) {
      throw new ApiError(
        503,
        "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.",
        "supabase_not_configured",
      );
    }

    return gateway;
  }

  async function requireUser(request: FastifyRequest, _reply: FastifyReply) {
    const token = getBearerToken(request);

    if (!token) {
      throw new ApiError(401, "Missing bearer token", "missing_token");
    }

    const user = await getGateway().getUserFromToken(token);

    if (!user) {
      throw new ApiError(401, "Invalid bearer token", "invalid_token");
    }

    (request as AuthenticatedRequest).user = user;
  }

  async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    await requireUser(request, reply);

    if ((request as AuthenticatedRequest).user.role !== "admin") {
      throw new ApiError(403, "Admin role required", "admin_required");
    }
  }

  app.get("/health", async () => ({
    environment: env.NODE_ENV,
    ok: true,
    service: "ayri-leaderboard-api",
    supabaseConfigured: Boolean(gateway),
  }));

  app.get("/v1/drink-types", async () => ({
    drinkTypes: await getGateway().listDrinkTypes(),
  }));

  app.post("/v1/invitations", async (request, reply) => {
    const body = parseWith(invitationSchema, request.body);
    const invitation = await getGateway().createInvitation(body);

    reply.status(201).send({ invitation });
  });

  app.post("/v1/bootstrap/admin", async (request, reply) => {
    if (!bootstrapAdminToken) {
      throw new ApiError(404, "Bootstrap admin is disabled", "bootstrap_disabled");
    }

    if (request.headers["x-bootstrap-token"] !== bootstrapAdminToken) {
      throw new ApiError(401, "Invalid bootstrap token", "invalid_bootstrap_token");
    }

    const body = parseWith(bootstrapAdminSchema, request.body);
    const user = await getGateway().bootstrapAdmin(body);

    reply.status(201).send({ user });
  });

  app.get(
    "/v1/me",
    {
      preHandler: requireUser,
    },
    async (request) => ({
      user: serializeUser((request as AuthenticatedRequest).user),
    }),
  );

  app.get(
    "/v1/leaderboard",
    {
      preHandler: requireUser,
    },
    async () => ({
      leaderboard: await getGateway().getLeaderboard(),
    }),
  );

  app.get(
    "/v1/activity",
    {
      preHandler: requireUser,
    },
    async (request) => {
      const query = parseWith(limitQuerySchema, request.query);

      return {
        activity: await getGateway().listActivity(query.limit),
      };
    },
  );

  app.get(
    "/v1/participants/:userId/history",
    {
      preHandler: requireUser,
    },
    async (request) => {
      const params = parseWith(userParamsSchema, request.params);

      return {
        history: await getGateway().getParticipantHistory(params.userId),
      };
    },
  );

  app.post(
    "/v1/drink-entries",
    {
      preHandler: requireUser,
    },
    async (request, reply) => {
      const body = parseWith(drinkEntrySchema, request.body);
      const entry = await getGateway().createDrinkEntry({
        ...body,
        userId: (request as AuthenticatedRequest).user.id,
      });

      reply.status(201).send({ entry });
    },
  );

  app.get(
    "/v1/admin/invitations",
    {
      preHandler: requireAdmin,
    },
    async () => ({
      invitations: await getGateway().listInvitations(),
    }),
  );

  app.post(
    "/v1/admin/invitations/:invitationId/accept",
    {
      preHandler: requireAdmin,
    },
    async (request, reply) => {
      const params = parseWith(invitationParamsSchema, request.params);
      const body = parseWith(acceptInvitationSchema, request.body ?? {});
      const result = await getGateway().acceptInvitation({
        adminUserId: (request as AuthenticatedRequest).user.id,
        displayName: body.displayName,
        invitationId: params.invitationId,
        role: body.role,
      });

      reply.status(201).send(result);
    },
  );

  app.post(
    "/v1/admin/invitations/:invitationId/reject",
    {
      preHandler: requireAdmin,
    },
    async (request) => {
      const params = parseWith(invitationParamsSchema, request.params);
      const invitation = await getGateway().rejectInvitation({
        adminUserId: (request as AuthenticatedRequest).user.id,
        invitationId: params.invitationId,
      });

      return { invitation };
    },
  );

  app.post(
    "/v1/admin/users/:userId/reset-password",
    {
      preHandler: requireAdmin,
    },
    async (request) => {
      const params = parseWith(userParamsSchema, request.params);

      return await getGateway().resetUserPassword({
        userId: params.userId,
      });
    },
  );

  return app;
}
