import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * GET /api/ipad/upload/:filename
 * Serves uploaded files from public/uploads/.
 * Next.js doesn't serve files added after build, so this route handles it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    await requireApiUser(request, 'read');
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }

  const { filename } = await params;

  // Sanitize: only allow alphanumeric, dash, dot, underscore, and block path traversal
  if (!/^[a-zA-Z0-9._-]+$/.test(filename) || filename.includes('..')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), 'public', 'uploads', filename);

  try {
    const buffer = await readFile(filePath);
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Content-Length': String(buffer.length),
      },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
