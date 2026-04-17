import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@remotion/renderer', '@remotion/bundler', 'sucrase'],
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default config;
