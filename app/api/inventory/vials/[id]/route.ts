'use server';

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { deleteVial, updateVial } from '@/lib/inventoryQueries';

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  await requireApiUser(request, 'admin');
  const vialId = params?.id;
  if (!vialId) {
    return NextResponse.json({ error: 'Vial id required.' }, { status: 400 });
  }
  try {
    await deleteVial(vialId, { removeLogs: true });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete vial', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  await requireApiUser(request, 'write');
  const vialId = params?.id;
  if (!vialId) {
    return NextResponse.json({ error: 'Vial id required.' }, { status: 400 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const updated = await updateVial(vialId, {
      deaDrugName: body?.deaDrugName ?? null,
      deaDrugCode: body?.deaDrugCode ?? null
    });
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('Failed to update vial', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

