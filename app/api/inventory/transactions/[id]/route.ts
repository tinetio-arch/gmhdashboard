import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { deleteDispense } from '@/lib/inventoryQueries';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireApiUser(request, 'write');
    
    const dispenseId = params.id;
    
    if (!dispenseId) {
      return NextResponse.json({ error: 'Dispense ID is required.' }, { status: 400 });
    }

    await deleteDispense(dispenseId, {
      userId: user.user_id,
      role: user.role,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API] Error deleting dispense transaction:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete dispense transaction.' },
      { status: 500 }
    );
  }
}






