import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

const PROTECTED_PATHS = ['/studio', '/dashboard'];

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const isProtected = PROTECTED_PATHS.some(p => nextUrl.pathname.startsWith(p));

  // TM-95: also treat sessions with no user (ghost JWT after DB reset — see
  // session callback in src/lib/auth.ts) as unauthenticated.
  if (isProtected && !session?.user) {
    const callbackUrl = encodeURIComponent(nextUrl.pathname + nextUrl.search);
    if (process.env.DEV_AUTO_LOGIN === 'true') {
      // Server-side auto-login: redirect to API GET handler which performs
      // signIn() without depending on client JS hydration. Avoids the failure
      // mode where AutoLoginForm's useEffect never fires (hydration error,
      // strict-mode double-mount cancel, etc.) leaving the user stuck on a
      // blank "Logging in..." page. (TM-95)
      return NextResponse.redirect(new URL(`/api/dev/auto-login?callbackUrl=${callbackUrl}`, nextUrl));
    }
    return NextResponse.redirect(new URL(`/login?callbackUrl=${callbackUrl}`, nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
