#!/usr/bin/env npx tsx
/**
 * Heartbeat Writer - Records dashboard uptime for startup sync detection
 * 
 * This script writes the current timestamp to a file every 5 minutes.
 * The startup-payment-sync script uses this to detect extended downtime.
 * 
 * Run via cron every 5 minutes
 */

import fs from 'fs';
import path from 'path';

const HEARTBEAT_FILE = path.join(__dirname, '..', '.heartbeat');

function writeHeartbeat() {
    const timestamp = Date.now();
    const data = {
        timestamp,
        isoTime: new Date(timestamp).toISOString(),
        service: 'gmh-dashboard'
    };

    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(data, null, 2));
    console.log(`[Heartbeat] Written: ${data.isoTime}`);
}

writeHeartbeat();
