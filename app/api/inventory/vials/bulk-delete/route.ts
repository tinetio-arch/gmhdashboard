'use server';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiUser } from '@/lib/auth';
import { deleteVial } from '@/lib/inventoryQueries';

const payloadSchema = z.object({
  vialIds: z.array(z.string().uuid()).min(1)
});

export async function POST(request: NextRequest) {
  await requireApiUser(request, 'admin');
  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload. Provide vialIds array.' }, { status: 400 });
  }

  const results: Array<{ vialId: string; success: boolean; error?: string }> = [];
  for (const vialId of parsed.data.vialIds) {
    try {
      await deleteVial(vialId, { removeLogs: true });
      results.push({ vialId, success: true });
    } catch (error) {
      console.error('Failed to bulk delete vial', vialId, error);
      results.push({ vialId, success: false, error: (error as Error).message });
    }
  }

  const failures = results.filter((entry) => !entry.success);
  return NextResponse.json(
    { success: failures.length === 0, results },
    { status: failures.length === 0 ? 200 : 207 }
  );
}


