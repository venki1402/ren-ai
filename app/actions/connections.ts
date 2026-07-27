"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { deleteConnection } from "@/lib/oauth";
import type { PlatformId } from "@/lib/platforms";

// Disconnect a platform OAuth connection (doc Section 7). Removes the stored
// encrypted tokens; the connect flow lives in the /api/oauth routes.
export async function disconnectPlatform(platform: PlatformId): Promise<void> {
  const user = await requireUser();
  await deleteConnection(user.id, platform);
  revalidatePath("/settings");
}
