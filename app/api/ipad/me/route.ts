import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';

/**
 * GET /api/ipad/me
 * Returns the current authenticated user's profile for the iPad app.
 * Used to determine role-based tab visibility and permissions.
 */
export async function GET(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'read');

        return NextResponse.json({
            user_id: user.user_id,
            email: user.email,
            role: user.role,
            display_name: user.display_name,
            is_provider: user.is_provider,
            can_sign: user.can_sign,
            is_active: user.is_active,
            // Computed permissions for the iPad app
            permissions: {
                can_view_ceo_dashboard: user.role === 'admin',
                can_use_scribe: user.role === 'admin' || user.role === 'write' || user.is_provider,
                can_dispense: true,
                can_sign_notes: user.can_sign,
                can_edit_inventory: true, // All staff can manage inventory
                can_order_labs: true,
                can_view_patients: true,
                can_send_messages: user.role === 'admin' || user.role === 'write',
                can_enter_metrics: true, // All staff can enter vitals/metrics
            }
        });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }
        console.error('[/api/ipad/me] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
