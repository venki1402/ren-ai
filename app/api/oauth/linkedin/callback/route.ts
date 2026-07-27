import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getAdapter } from "@/lib/adapters";
import { saveConnection } from "@/lib/oauth";

// LinkedIn OAuth callback (doc Section 7). Verifies the CSRF state against the
// httpOnly cookie, exchanges the code for tokens, and stores them encrypted.
export const dynamic = "force-dynamic";

const STATE_COOKIE = "li_oauth_state";

export async function GET(request: NextRequest) {
  const user = await requireUser();

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const done = (query: string) =>
    NextResponse.redirect(`${base}/settings?${query}`);

  const jar = await cookies();
  const storedState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  if (oauthError) return done("error=denied");
  if (!code || !returnedState || returnedState !== storedState) {
    return done("error=state");
  }

  try {
    const token = await getAdapter("linkedin").handleOAuthCallback(code);
    await saveConnection(user.id, "linkedin", token);
    return done("connected=linkedin");
  } catch {
    return done("error=exchange");
  }
}
