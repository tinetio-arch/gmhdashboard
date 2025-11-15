'use server';

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createVial } from '@/lib/inventoryQueries';

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildSequentialExternalIds(base: string | undefined, count: number): (string | undefined)[] {
  if (!base || !base.trim() || count <= 0) {
    return Array(Math.max(count, 0)).fill(undefined);
  }
  const trimmed = base.trim();
  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (!match) {
    return Array.from({ length: count }, (_, index) =>
      index === 0 ? trimmed : `${trimmed}-${String(index + 1).padStart(2, '0')}`
    );
  }
  const prefix = match[1];
  const numericPart = match[2];
  const width = numericPart.length;
  const start = Number.parseInt(numericPart, 10);
  if (!Number.isFinite(start)) {
    return Array.from({ length: count }, (_, index) =>
      index === 0 ? trimmed : `${trimmed}-${String(index + 1).padStart(2, '0')}`
    );
  }
  return Array.from({ length: count }, (_, index) => `${prefix}${String(start + index).padStart(width, '0')}`);
}

export async function POST(request: NextRequest) {
  await requireApiUser(request, 'write');

  try {
    const body = await request.json();
    if (!body) {
      return NextResponse.json({ error: 'Request body required.' }, { status: 400 });
    }

    const countValue = body.count ?? 1;
    const count = Number(countValue);
    if (!Number.isFinite(count) || count < 1) {
      return NextResponse.json({ error: 'count must be a positive number.' }, { status: 400 });
    }

    const externalId = typeof body.externalId === 'string' ? body.externalId.trim() : '';
    const autoGenerate = body.autoGenerate ?? externalId.length === 0;
    const baseIds = autoGenerate ? Array(Math.floor(count)).fill(undefined) : buildSequentialExternalIds(externalId, Math.floor(count));

    const created = [];
    for (let index = 0; index < Math.floor(count); index += 1) {
      const entry = await createVial({
        externalId: baseIds[index],
        lotNumber: body.lotNumber ?? null,
        status: body.status ?? null,
        remainingVolumeMl: parseNullableNumber(body.remainingVolumeMl),
        sizeMl: parseNullableNumber(body.sizeMl),
        expirationDate: body.expirationDate ?? null,
        dateReceived: body.dateReceived ?? null,
        deaDrugName: body.deaDrugName ?? null,
        deaDrugCode: body.deaDrugCode ?? null,
        controlledSubstance: Boolean(body.controlledSubstance),
        location: body.location ?? null,
        notes: body.notes ?? null
      });
      created.push(entry);
    }

    return NextResponse.json({ success: true, created });
  } catch (error) {
    console.error('Failed to create vial', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

