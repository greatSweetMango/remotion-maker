import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['@remotion/renderer', '@remotion/bundler', 'sucrase'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  env: {
    DEV_AUTO_LOGIN: process.env.DEV_AUTO_LOGIN ?? '',
  },
};

export default config;
