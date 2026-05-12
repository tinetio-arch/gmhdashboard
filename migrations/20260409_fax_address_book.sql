-- Fax Address Book — stores referring provider/facility fax contacts
CREATE TABLE IF NOT EXISTS fax_address_book (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    specialty TEXT,
    email TEXT,
    phone TEXT,
    fax TEXT,
    address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fax_address_book_name ON fax_address_book(name);
