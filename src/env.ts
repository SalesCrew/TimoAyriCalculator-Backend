import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  BOOTSTRAP_ADMIN_TOKEN: z.string().optional().or(z.literal("")),
  SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  SUPABASE_SECRET_KEY: z.string().optional().or(z.literal("")),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== "production") {
    return;
  }

  if (!value.SUPABASE_URL) {
    context.addIssue({
      code: "custom",
      message: "SUPABASE_URL is required in production",
      path: ["SUPABASE_URL"],
    });
  }

  if (!value.SUPABASE_SECRET_KEY) {
    context.addIssue({
      code: "custom",
      message: "SUPABASE_SECRET_KEY is required in production",
      path: ["SUPABASE_SECRET_KEY"],
    });
  }
});

export const env = envSchema.parse(process.env);

export const allowedOrigins = env.FRONTEND_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const hasSupabaseConfig = Boolean(
  env.SUPABASE_URL && env.SUPABASE_SECRET_KEY,
);
