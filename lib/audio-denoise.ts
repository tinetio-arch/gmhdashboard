/**
 * Audio denoising integration for the scribe pipeline.
 *
 * Two modes:
 * - Direct: runs ffmpeg inline (for API route uploads via S3)
 * - File watcher: resolves cleaned files from /srv/scribe/clean (for file-based uploads)
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';

const execFileAsync = promisify(execFile);

const TEMP_DIR = '/tmp/scribe-denoise';
const FFMPEG_PATH = '/usr/local/bin/ffmpeg';
const RNNOISE_MODEL = process.env.RNNOISE_MODEL || '/srv/rnnoise-models/active-model.rnnn';
const RNNOISE_MIX = process.env.RNNOISE_MIX || '0.85';
const FFMPEG_TIMEOUT_MS = 60_000; // 60 seconds

const CLEAN_DIR = '/srv/scribe/clean';
const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 120_000;

/**
 * Direct denoise: takes a buffer, runs ffmpeg with RNNoise, returns cleaned buffer.
 * Used by the transcribe API route before uploading to S3.
 * Falls back gracefully if ffmpeg or model is missing.
 */
export async function denoiseAudioBuffer(
    inputBuffer: Buffer,
    inputExt: string
): Promise<{ buffer: Buffer; format: string; durationMs: number }> {
    const id = randomUUID();
    const inputPath = path.join(TEMP_DIR, `${id}.${inputExt}`);
    // Output as WAV for best AWS Transcribe compatibility
    const outputPath = path.join(TEMP_DIR, `${id}-clean.wav`);

    await mkdir(TEMP_DIR, { recursive: true });
    await writeFile(inputPath, inputBuffer);

    const start = Date.now();
    try {
        // Check if RNNoise model exists — if not, fall back to basic filters only
        const hasModel = existsSync(RNNOISE_MODEL);
        const filterChain = hasModel
            ? `highpass=f=80,arnndn=m='${RNNOISE_MODEL}':mix=${RNNOISE_MIX},acompressor=threshold=-25dB:ratio=3:attack=5:release=50,loudnorm=I=-16:TP=-1.5:LRA=11`
            : `highpass=f=80,lowpass=f=8000,afftdn=nf=-25,acompressor=threshold=-25dB:ratio=3:attack=5:release=50,loudnorm=I=-16:TP=-1.5:LRA=11`;

        await execFileAsync(FFMPEG_PATH, [
            '-i', inputPath,
            '-af', filterChain,
            '-ar', '16000',
            '-ac', '1',
            '-y', outputPath,
        ], { timeout: FFMPEG_TIMEOUT_MS });

        const outputBuffer = await readFile(outputPath);
        const durationMs = Date.now() - start;
        console.log(`[Scribe:Denoise] Processed in ${durationMs}ms (${(inputBuffer.length / 1024).toFixed(0)}KB → ${(outputBuffer.length / 1024).toFixed(0)}KB) model=${hasModel ? path.basename(RNNOISE_MODEL) : 'fallback'}`);
        return { buffer: outputBuffer, format: 'wav', durationMs };
    } finally {
        await unlink(inputPath).catch(() => {});
        await unlink(outputPath).catch(() => {});
    }
}

/**
 * File-based resolver: waits for a cleaned file to appear in /srv/scribe/clean.
 * Used when files are dropped into /srv/scribe/incoming and processed by the systemd watcher.
 */
export async function resolveCleanAudio(originalFilename: string): Promise<string> {
    const ext = path.extname(originalFilename);
    const name = path.basename(originalFilename, ext);
    const cleanPath = path.join(CLEAN_DIR, `${name}-clean${ext}`);

    const start = Date.now();
    while (Date.now() - start < MAX_WAIT_MS) {
        if (existsSync(cleanPath)) return cleanPath;
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error(`Denoised file not ready after ${MAX_WAIT_MS / 1000}s: ${cleanPath}`);
}
