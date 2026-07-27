import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { getAdapter } from "@/lib/adapters";

// Start the LinkedIn OAuth flow (doc Section 7). Mints a CSRF `state`, stores it
// in an httpOnly cookie, and redirects to LinkedIn's consent screen. The user
// must already be signed in to Ren (Clerk) — platform OAuth is separate.
export const dynamic = "force-dynamic";

const STATE_COOKIE = "li_oauth_state";

export async function GET() {
  await requireUser();

  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes to complete the flow
  });

  const url = getAdapter("linkedin").getAuthUrl("", state);
  return NextResponse.redirect(url);
}
