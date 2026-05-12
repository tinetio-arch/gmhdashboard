import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ipad/upload
 * Accepts an image file upload via multipart/form-data.
 * Returns both a public URL (for MMS) and base64 data URL (for Healthie).
 *
 * Response: { success, url, base64, filename, mimeType }
 */
export async function POST(request: NextRequest) {
  await requireApiUser(request, 'write');

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}. Allowed: images, PDF, DOC/DOCX` },
        { status: 400 }
      );
    }

    // Limit file size to 10MB
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum 10MB.' },
        { status: 400 }
      );
    }

    // Read file into buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate unique filename
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
      'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    };
    const ext = extMap[file.type] || file.name.split('.').pop() || 'bin';
    const hash = crypto.randomBytes(8).toString('hex');
    const filename = `msg-${Date.now()}-${hash}.${ext}`;

    // Write to public/uploads/
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);

    // Build public URL — served via API route since Next.js doesn't serve post-build static files
    const publicUrl = `https://nowoptimal.com/ops/api/ipad/upload/${filename}`;

    // Build base64 data URL for Healthie
    const base64 = `data:${file.type};base64,${buffer.toString('base64')}`;

    console.log(`[Upload] Stored ${filename} (${(file.size / 1024).toFixed(1)}KB, ${file.type})`);

    return NextResponse.json({
      success: true,
      url: publicUrl,
      base64,
      filename,
      mimeType: file.type,
      size: file.size,
    });
  } catch (error) {
    console.error('[Upload] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    );
  }
}
