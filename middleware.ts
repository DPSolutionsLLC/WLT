import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER } from "@/lib/access/releasedModules";
import { updateSession } from "@/lib/supabase/middleware";

// Routes reachable without a session. /invite and /pin have no pages until auth-b and auth-c;
// they are listed now so those plans do not have to reopen this file.
const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/invite",
  "/pin",
  "/public",
];

// No role checks here, deliberately. Middleware runs on the edge with no cheap database
// access, so resolving a role would mean a second round trip on every single request.
// Enforcement lives in app/(app)/layout.tsx and in each page's assertCan() call
// (01-auth-rbac.md §Pitfalls).
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
  // The page path, for lib/access/requireReleasedRoute.ts — a layout cannot read its own URL. Set
  // on the REQUEST before updateSession() builds its response, because that response is
  // `NextResponse.next({ request })`, which forwards these headers to Server Components; the
  // cookie handling is untouched. Always overwritten, so a value a client sent is never read.
  const { pathname } = request.nextUrl;
  request.headers.set(PATHNAME_HEADER, pathname);

  const { response, user } = await updateSession(request);

  // API routes answer with a status code; redirecting them would turn a 401 the caller can
  // handle into an HTML login page it cannot.
  if (pathname.startsWith("/api/")) return response;

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|public/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
