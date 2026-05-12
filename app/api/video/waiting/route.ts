/**
 * Video Waiting Room — tracks patients waiting in video sessions
 *
 * POST /api/video/waiting — patient signals they're connected and waiting
 * GET  /api/video/waiting — iPad polls for patients currently waiting
 *
 * Uses in-memory store (no DB needed — waiting state is ephemeral).
 * Entries auto-expire after 10 minutes.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface WaitingEntry {
  appointmentId: string;
  patientName: string;
  connectedAt: number; // epoch ms
}

// In-memory map: appointmentId → WaitingEntry
const waitingRoom = new Map<string, WaitingEntry>();
const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function pruneExpired() {
  const now = Date.now();
  for (const [key, entry] of waitingRoom) {
    if (now - entry.connectedAt > EXPIRY_MS) {
      waitingRoom.delete(key);
    }
  }
}

/** POST — patient signals they're waiting */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { appointmentId, patientName, action } = body;

    if (!appointmentId) {
      return NextResponse.json({ error: 'appointmentId required' }, { status: 400 });
    }

    if (action === 'leave') {
      waitingRoom.delete(appointmentId);
      console.log(`[Video Waiting] Patient left: ${patientName || 'unknown'} (appt ${appointmentId})`);
      return NextResponse.json({ ok: true });
    }

    waitingRoom.set(appointmentId, {
      appointmentId,
      patientName: patientName || 'Patient',
      connectedAt: Date.now(),
    });

    console.log(`[Video Waiting] Patient waiting: ${patientName || 'unknown'} (appt ${appointmentId})`);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** GET — iPad polls for waiting patients */
export async function GET() {
  pruneExpired();
  const entries = Array.from(waitingRoom.values()).map(e => ({
    appointmentId: e.appointmentId,
    patientName: e.patientName,
    waitingMinutes: Math.floor((Date.now() - e.connectedAt) / 60000),
  }));
  return NextResponse.json({ waiting: entries });
}
