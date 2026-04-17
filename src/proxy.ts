import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

const PROTECTED_PATHS = ['/studio', '/dashboard'];

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const isProtected = PROTECTED_PATHS.some(p => nextUrl.pathname.startsWith(p));

  if (isProtected && !session) {
    return NextResponse.redirect(new URL('/login', nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
