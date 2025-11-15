'use server';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiUser } from '@/lib/auth';
import { exportDeaLogToS3 } from '@/lib/exporters';

const exportSchema = z.object({
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  bucket: z.string().optional().nullable(),
  prefix: z.string().optional().nullable()
});

export async function POST(request: NextRequest) {
  await requireApiUser(request, 'admin');
  const body = await request.json().catch(() => ({}));
  const parsed = exportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  try {
    const result = await exportDeaLogToS3(parsed.data);
    if (!result) {
      return NextResponse.json({ message: 'No export generated.' }, { status: 200 });
    }
    return NextResponse.json({ success: true, key: result.key });
  } catch (error) {
    console.error('Failed to export DEA log to S3', error);
    return NextResponse.json({ error: 'Failed to export DEA log' }, { status: 500 });
  }
}
