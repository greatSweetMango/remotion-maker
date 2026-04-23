import { redirect } from 'next/navigation';
import { AutoLoginForm } from './AutoLoginForm';

interface Props {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function DevLoginPage({ searchParams }: Props) {
  if (process.env.DEV_AUTO_LOGIN !== 'true') {
    redirect('/login');
  }

  const { callbackUrl } = await searchParams;

  return (
    <div className="flex items-center justify-center h-screen bg-slate-950">
      <AutoLoginForm callbackUrl={callbackUrl ?? '/studio'} />
      <p className="text-slate-400 text-sm">Logging in...</p>
    </div>
  );
}
