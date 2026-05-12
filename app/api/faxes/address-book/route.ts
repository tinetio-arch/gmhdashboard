import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

/**
 * GET /api/faxes/address-book — List fax contacts (optionally filtered by search query)
 * POST /api/faxes/address-book — Add a new contact
 */

interface AddressBookEntry {
    id: string;
    name: string;
    specialty: string | null;
    email: string | null;
    phone: string | null;
    fax: string | null;
    address: string | null;
}

export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
    } catch {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();

    let contacts: AddressBookEntry[];
    if (q) {
        contacts = await query<AddressBookEntry>(
            `SELECT id, name, specialty, email, phone, fax, address FROM fax_address_book
             WHERE LOWER(name) LIKE $1 OR LOWER(specialty) LIKE $1 OR LOWER(keywords) LIKE $1
             ORDER BY name LIMIT 50`,
            [`%${q.toLowerCase()}%`]
        );
    } else {
        contacts = await query<AddressBookEntry>(
            `SELECT id, name, specialty, email, phone, fax, address FROM fax_address_book ORDER BY name LIMIT 100`
        );
    }

    return NextResponse.json({ success: true, contacts });
}

export async function POST(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');
    } catch {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { name, specialty, email, phone, fax, address } = body;

        if (!name?.trim()) {
            return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
        }

        const result = await query<AddressBookEntry>(
            `INSERT INTO fax_address_book (name, specialty, email, phone, fax, address)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, name, specialty, email, phone, fax, address`,
            [name.trim(), specialty?.trim() || null, email?.trim() || null, phone?.trim() || null, fax?.trim() || null, address?.trim() || null]
        );

        return NextResponse.json({ success: true, contact: result[0] });
    } catch (error: any) {
        console.error('[API:FaxAddressBook] Error:', error.message);
        return NextResponse.json({ success: false, error: 'Failed to add contact' }, { status: 500 });
    }
}
