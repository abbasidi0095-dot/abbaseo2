import { createMiddleware } from "@tanstack/react-start";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { AppError } from "@/server/lib/errors";
import { errorHandlingMiddleware } from "@/middleware/errorHandling";
import type { EnsuredUserContext } from "@/middleware/ensure-user/types";
import { ensureUserMiddleware } from "@/middleware/ensureUser";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getAuthMode } from "@/lib/auth-mode";
import {
  getOptionalEnvValue,
  isHostedServerAuthMode,
} from "@/server/lib/runtime-env";
import { canManageDeploymentSettings } from "@/server/features/settings/settingsAccess";

const ensuredUserContextSchema: z.ZodType<EnsuredUserContext> = z.object({
  userId: z.string(),
  userEmail: z.string(),
  emailVerified: z.boolean(),
  organizationId: z.string(),
  project: z.any().optional(),
});

function getAuthenticatedContext(context: unknown): EnsuredUserContext {
  const result = ensuredUserContextSchema.safeParse(context);
  if (!result.success) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Authenticated server function context missing",
    );
  }
  return result.data;
}

export const globalServerFunctionMiddleware = [
  errorHandlingMiddleware,
  ensureUserMiddleware,
] as const;

export const requireAuthenticatedContext = [
  createMiddleware({ type: "function" }).server(async ({ next, context }) => {
    const authenticatedContext = getAuthenticatedContext(context);

    return next({
      context: authenticatedContext,
    });
  }),
] as const;

export const requireSettingsAdminContext = [
  ...requireAuthenticatedContext,
  createMiddleware({ type: "function" }).server(async ({ next, context }) => {
    const authenticatedContext = getAuthenticatedContext(context);
    const isHosted = await isHostedServerAuthMode();
    const authMode = getAuthMode(await getOptionalEnvValue("AUTH_MODE"));
    const [adminEmail, membership] = await Promise.all([
      getOptionalEnvValue("SETTINGS_ADMIN_EMAIL"),
      isHosted
        ? db.query.member.findFirst({
            columns: { role: true },
            where: and(
              eq(member.organizationId, authenticatedContext.organizationId),
              eq(member.userId, authenticatedContext.userId),
            ),
          })
        : Promise.resolve(undefined),
    ]);

    if (
      !canManageDeploymentSettings({
        authMode,
        userEmail: authenticatedContext.userEmail,
        adminEmail,
        role: membership?.role,
      })
    ) {
      throw new AppError(
        "FORBIDDEN",
        "Only the deployment administrator can manage application settings.",
      );
    }

    return next({ context: authenticatedContext });
  }),
] as const;

export const requireProjectContext = [
  createMiddleware({ type: "function" }).server(async ({ next, context }) => {
    const authenticatedContext = getAuthenticatedContext(context);

    if (!authenticatedContext.project) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Project context missing from authenticated server function",
      );
    }

    return next({
      context: {
        ...authenticatedContext,
        project: authenticatedContext.project,
        projectId: authenticatedContext.project.id,
      },
    });
  }),
] as const;
