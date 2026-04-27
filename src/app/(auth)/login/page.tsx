'use client';
import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Zap } from 'lucide-react';

/**
 * Restrict callbackUrl to same-origin relative paths to prevent open-redirect.
 * Accepts "/foo", "/foo?bar=1"; rejects "//evil", "http://...", "javascript:".
 */
function safeCallbackUrl(raw: string | null | undefined, fallback = '/studio') {
  if (!raw) return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//')) return fallback;
  return raw;
}

// Inner component reads searchParams, so it must live under a Suspense
// boundary per Next.js 16 prerender rules.
function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams?.get('callbackUrl'));
  const [loading, setLoading] = useState(false);
  const [loginData, setLoginData] = useState({ email: '', password: '' });
  const [registerData, setRegisterData] = useState({ email: '', password: '', name: '' });

  async function handleGoogleSignIn() {
    setLoading(true);
    await signIn('google', { callbackUrl });
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const result = await signIn('credentials', {
      ...loginData,
      redirect: false,
    });
    if (result?.error) {
      toast.error('Invalid credentials');
      setLoading(false);
    } else {
      router.push(callbackUrl);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerData),
    });
    if (!res.ok) {
      const { error } = await res.json();
      toast.error(error);
      setLoading(false);
      return;
    }
    await signIn('credentials', {
      email: registerData.email,
      password: registerData.password,
      callbackUrl,
    });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Zap className="h-8 w-8 text-violet-400" />
            <span className="text-2xl font-bold text-white">EasyMake</span>
          </div>
          <p className="text-slate-400">Animate anything, your way</p>
        </div>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">Get started</CardTitle>
            <CardDescription className="text-slate-400">Sign in or create your account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={handleGoogleSignIn}
              disabled={loading}
              variant="outline"
              className="w-full border-slate-600 text-white hover:bg-slate-700"
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </Button>

            <div className="flex items-center gap-2">
              <Separator className="flex-1 bg-slate-600" />
              <span className="text-slate-400 text-xs">or</span>
              <Separator className="flex-1 bg-slate-600" />
            </div>

            <Tabs defaultValue="login">
              <TabsList className="w-full bg-slate-700">
                <TabsTrigger value="login" className="flex-1">Sign In</TabsTrigger>
                <TabsTrigger value="register" className="flex-1">Register</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-3">
                  <div>
                    <Label className="text-slate-300">Email</Label>
                    <Input
                      type="email"
                      value={loginData.email}
                      onChange={e => setLoginData(p => ({ ...p, email: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Password</Label>
                    <Input
                      type="password"
                      value={loginData.password}
                      onChange={e => setLoginData(p => ({ ...p, password: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="••••••••"
                      required
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full bg-violet-600 hover:bg-violet-700">
                    Sign In
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-3">
                  <div>
                    <Label className="text-slate-300">Name</Label>
                    <Input
                      value={registerData.name}
                      onChange={e => setRegisterData(p => ({ ...p, name: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Email</Label>
                    <Input
                      type="email"
                      value={registerData.email}
                      onChange={e => setRegisterData(p => ({ ...p, email: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Password</Label>
                    <Input
                      type="password"
                      value={registerData.password}
                      onChange={e => setRegisterData(p => ({ ...p, password: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="••••••••"
                      minLength={8}
                      required
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full bg-violet-600 hover:bg-violet-700">
                    Create Account
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-slate-500 text-sm">
          By continuing, you agree to our Terms of Service
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}
