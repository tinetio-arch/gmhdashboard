'use server';

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { deleteDispense } from '@/lib/inventoryQueries';

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireApiUser(request, 'admin');
  try {
    await deleteDispense(params.id, { userId: user.user_id, role: user.role });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete transaction', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

