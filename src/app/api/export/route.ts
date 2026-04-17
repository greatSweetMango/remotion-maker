import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

export const runtime = 'nodejs';
export const maxDuration = 120;

const PRO_FORMATS = ['mp4', 'webm'];

let bundleCache: string | null = null;

async function getBundlePath(): Promise<string> {
  if (bundleCache) return bundleCache;

  const entryPoint = path.resolve(process.cwd(), 'src/remotion/UniversalComposition.tsx');
  bundleCache = await bundle({
    entryPoint,
    webpackOverride: (config) => config,
  });

  return bundleCache;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { assetId, format, paramValues } = await req.json();

  if (format === 'react') {
    return NextResponse.json({ error: 'React export handled client-side' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (PRO_FORMATS.includes(format) && user.tier !== 'PRO') {
    return NextResponse.json({ error: `${format.toUpperCase()} export requires Pro plan` }, { status: 403 });
  }

  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset || asset.userId !== user.id) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'easymake-'));
  const outPath = path.join(tmpDir, `output.${format}`);

  try {
    const bundlePath = await getBundlePath();

    const codec = format === 'gif' ? 'gif' : format === 'webm' ? 'vp8' : 'h264';
    const mimeType = format === 'gif' ? 'image/gif' : format === 'webm' ? 'video/webm' : 'video/mp4';

    const inputProps = {
      jsCode: asset.jsCode,
      params: paramValues || {},
    };

    const composition = await selectComposition({
      serveUrl: bundlePath,
      id: 'UniversalComposition',
      inputProps,
    });

    await renderMedia({
      composition,
      serveUrl: bundlePath,
      codec,
      outputLocation: outPath,
      inputProps,
      ...(format === 'gif' ? { imageFormat: 'png' as const } : {}),
    });

    const fileBuffer = await fs.readFile(outPath);
    const filename = `${asset.title.replace(/\s+/g, '_')}.${format}`;

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (err: unknown) {
    console.error('Export error:', err);
    const message = err instanceof Error ? err.message : 'Export failed';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
