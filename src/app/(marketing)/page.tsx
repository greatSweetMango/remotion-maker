import { getTemplates } from '@/lib/templates';
import LandingClient from './_LandingClient';

export default async function LandingPage() {
  const templates = await getTemplates();
  return <LandingClient templates={templates} />;
}
