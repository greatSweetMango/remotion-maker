import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['@remotion/renderer', '@remotion/bundler', 'sucrase'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default config;
