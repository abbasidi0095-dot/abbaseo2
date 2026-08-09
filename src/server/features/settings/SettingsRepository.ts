import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_APP_SETTINGS_PAYLOAD } from "@/server/features/settings/appSettingsSchema";

// The app_settings table holds exactly one row for the whole deployment.
export const APP_SETTINGS_ID = "app";

export type AppSettingsRow = typeof appSettings.$inferSelect;

export async function getAppSettingsRow(): Promise<AppSettingsRow | null> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_ID))
    .limit(1);
  return rows[0] ?? null;
}

// The stored value is already encrypted by the service; this layer only
// persists. onConflictDoUpdate keeps the single-row invariant regardless of
// dialect (D1 + Postgres).
export async function upsertAppSettings(
  value: string,
  expectedUpdatedAt: string | null,
): Promise<string | null> {
  const updatedAt = new Date().toISOString();
  if (expectedUpdatedAt) {
    const rows = await db
      .update(appSettings)
      .set({ value, updatedAt })
      .where(
        and(
          eq(appSettings.id, APP_SETTINGS_ID),
          eq(appSettings.updatedAt, expectedUpdatedAt),
        ),
      )
      .returning({ id: appSettings.id });
    return rows.length > 0 ? updatedAt : null;
  }

  const rows = await db
    .insert(appSettings)
    .values({ id: APP_SETTINGS_ID, value })
    .onConflictDoNothing({ target: appSettings.id })
    .returning({ id: appSettings.id });
  return rows.length > 0 ? updatedAt : null;
}

export async function getAppSettingsQueryCount(): Promise<number> {
  return (await getAppSettingsRow())?.queryCount ?? 0;
}

export async function incrementAppSettingsQueryCount(
  delta: number,
): Promise<void> {
  if (!Number.isInteger(delta) || delta <= 0) {
    throw new Error("DataForSEO query count delta must be a positive integer");
  }

  // Create the row before updating it so the counter also works before the
  // first Settings save. onConflictDoNothing makes this safe when requests
  // race to create the deployment-wide row.
  await db
    .insert(appSettings)
    .values({
      id: APP_SETTINGS_ID,
      value: `plain:v1:${JSON.stringify(DEFAULT_APP_SETTINGS_PAYLOAD)}`,
    })
    .onConflictDoNothing({ target: appSettings.id });

  await db
    .update(appSettings)
    .set({ queryCount: sql`${appSettings.queryCount} + ${delta}` })
    .where(eq(appSettings.id, APP_SETTINGS_ID));
}
