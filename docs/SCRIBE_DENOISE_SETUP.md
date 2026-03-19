# AntiGravity Prompt — RNNoise/ffmpeg Noise Reduction for Scribe Pipeline

---

You are an expert DevOps engineer and audio-processing developer.

I have a backend "scribe" server that receives audio recordings from iPads and then sends them to an AI scribe service. I want you to add an automatic RNNoise/ffmpeg noise-reduction step before the scribe runs.

---

## Environment and Requirements

- **Server OS:** Amazon Linux 2 on AWS EC2 (x86_64 architecture)
- **Runtime:** Node.js / Next.js 14.2 (TypeScript), managed by PM2 behind nginx
- **Process manager:** PM2 (all services run as user `ec2-user`)
- **Recordings arrive as:** `.m4a` (AAC) audio files uploaded from iPad/Mac clients to `/srv/scribe/incoming`
- **Cleaned files go to:** `/srv/scribe/clean`
- **My scribe app should then read from the cleaned files only**
- **Existing app base path:** The dashboard lives at `/home/ec2-user/gmhdashboard` and is accessed at `https://www.nowoptimal.com/ops/`
- **Init system:** systemd

---

## What I Want You to Implement

### 1. Install ffmpeg with arnndn Support (Amazon Linux 2 Specific)

Amazon Linux 2 does not ship ffmpeg in its default repos. Install a static build that includes the `arnndn` filter:

```bash
# Download the latest static ffmpeg build (x86_64) from John Van Sickle's trusted builds
cd /usr/local/bin
sudo curl -LO https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
sudo tar -xf ffmpeg-release-amd64-static.tar.xz --strip-components=1 --wildcards '*/ffmpeg' '*/ffprobe'
sudo rm ffmpeg-release-amd64-static.tar.xz
```

After installation, **verify** that the `arnndn` filter is present:

```bash
ffmpeg -filters 2>&1 | grep arnndn
# Expected output should include: arnndn  A->A  Reduce noise from speech using Recurrent Neural Networks.
```

If `arnndn` does NOT appear, the static build may be too old. In that case, use the BtbN builds instead:

```bash
sudo curl -LO https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz
sudo tar -xf ffmpeg-master-latest-linux64-gpl.tar.xz --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe'
```

The `mix` parameter requires ffmpeg **4.4 or newer**. Confirm with `ffmpeg -version`.

---

### 2. Download and Configure RNNoise Models

There are two model repositories. Download **both** to `/srv/rnnoise-models`:

```bash
sudo mkdir -p /srv/rnnoise-models
cd /srv/rnnoise-models

# Richardpl models (used directly by ffmpeg arnndn filter — .rnnn format)
sudo git clone https://github.com/richardpl/arnndn-models.git richardpl
# This gives you: std.rnnn, bd.rnnn, cb.rnnn, lq.rnnn, mp.rnnn, sh.rnnn

# GregorR models (more descriptive, must be converted or used as .rnnn via the richardpl pack)
sudo git clone https://github.com/GregorR/rnnoise-models.git gregorr
```

**Model Selection Guide** — use this table to pick the right model for clinical recordings:

| Expected Signal | Expected Noise | Model Name (GregorR) | Richardpl Equivalent | Best For |
|---|---|---|---|---|
| Voice | Recording | beguiling-drafter | `bd.rnnn` | **RECOMMENDED for clinic** — preserves voice including coughs/laughs, trained against indoor recording noise |
| Speech | Recording | somnolent-hogwash | `sh.rnnn` | Strictest — removes all non-speech human sounds; use if you want ONLY spoken words |
| Voice | General | leavened-quisling | `lq.rnnn` | Outdoor or unpredictable noise environments |
| General | Recording | conjoined-burgers | `cb.rnnn` | Preserves all sounds (music, alerts); removes recording noise only |
| Speech | General | orig / std | `std.rnnn` | The original Xiph model; general purpose |
| General | General | marathon-prescription | `mp.rnnn` | Least aggressive; preserves everything |

**Default recommendation for clinic exam rooms:** Use `bd.rnnn` (Voice + Recording noise). This preserves natural voice quality (including non-speech sounds like throat clearing that may be clinically relevant) while removing HVAC hum, room echo, and equipment noise. Symlink it for easy reference:

```bash
sudo ln -sf /srv/rnnoise-models/richardpl/bd.rnnn /srv/rnnoise-models/active-model.rnnn
```

---

### 3. Create the Denoise Script

Create `/usr/local/bin/denoise-scribe-audio.sh`:

```bash
#!/usr/bin/env bash
# denoise-scribe-audio.sh — RNNoise denoiser for scribe audio pipeline
# Usage: denoise-scribe-audio.sh <input-file> <output-file>
#
# Configuration (override via environment variables):
#   RNNOISE_MODEL   — path to .rnnn model (default: /srv/rnnoise-models/active-model.rnnn)
#   RNNOISE_MIX     — wet/dry mix 0.0–1.0 (default: 0.85)
#   FALLBACK_ON_FAIL — if "true", copy original to output on failure (default: false)

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────
RNNOISE_MODEL="${RNNOISE_MODEL:-/srv/rnnoise-models/active-model.rnnn}"
RNNOISE_MIX="${RNNOISE_MIX:-0.85}"
FALLBACK_ON_FAIL="${FALLBACK_ON_FAIL:-false}"
LOG_FILE="/var/log/scribe-denoise.log"

# ── Arguments ─────────────────────────────────────────────────────────
IN="${1:?Usage: $0 <input-file> <output-file>}"
OUT="${2:?Usage: $0 <input-file> <output-file>}"

# ── Validation ────────────────────────────────────────────────────────
if [[ ! -f "$IN" ]]; then
    echo "$(date -Iseconds) ERROR input file not found: $IN" | tee -a "$LOG_FILE"
    exit 1
fi

if [[ ! -f "$RNNOISE_MODEL" ]]; then
    echo "$(date -Iseconds) ERROR model file not found: $RNNOISE_MODEL" | tee -a "$LOG_FILE"
    exit 1
fi

# Ensure output directory exists
mkdir -p "$(dirname "$OUT")"

# ── Get input duration for logging ────────────────────────────────────
DURATION=$(ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "$IN" 2>/dev/null || echo "unknown")

# ── Detect input codec to preserve format ─────────────────────────────
INPUT_EXT="${IN##*.}"
INPUT_EXT_LOWER=$(echo "$INPUT_EXT" | tr '[:upper:]' '[:lower:]')

case "$INPUT_EXT_LOWER" in
    m4a|aac)
        CODEC_ARGS="-c:a aac -b:a 128k"
        ;;
    wav)
        CODEC_ARGS="-c:a pcm_s16le"
        ;;
    mp3)
        CODEC_ARGS="-c:a libmp3lame -b:a 192k"
        ;;
    opus|ogg)
        CODEC_ARGS="-c:a libopus -b:a 128k"
        ;;
    mp4|mov)
        # Video container — copy video stream, only denoise audio
        CODEC_ARGS="-c:v copy -c:a aac -b:a 128k"
        ;;
    *)
        # Default: re-encode as AAC in m4a container
        CODEC_ARGS="-c:a aac -b:a 128k"
        ;;
esac

# ── Build the ffmpeg filter chain ─────────────────────────────────────
# 1. highpass at 80Hz  — removes low-frequency rumble (HVAC, footsteps)
# 2. arnndn            — RNNoise neural denoiser (main noise reduction)
# 3. acompressor       — gentle compression to even out provider/patient volume differences
# 4. loudnorm          — EBU R128 loudness normalization for consistent scribe input levels
FILTER_CHAIN="highpass=f=80,arnndn=m='${RNNOISE_MODEL}':mix=${RNNOISE_MIX},acompressor=threshold=-25dB:ratio=3:attack=5:release=50,loudnorm=I=-16:TP=-1.5:LRA=11"

# ── Run ffmpeg ────────────────────────────────────────────────────────
START_TIME=$(date +%s%N)

if ffmpeg -hide_banner -loglevel warning \
    -i "$IN" \
    -af "$FILTER_CHAIN" \
    $CODEC_ARGS \
    -y "$OUT" 2>>"$LOG_FILE"; then

    END_TIME=$(date +%s%N)
    ELAPSED_MS=$(( (END_TIME - START_TIME) / 1000000 ))
    IN_SIZE=$(stat -c%s "$IN" 2>/dev/null || echo "?")
    OUT_SIZE=$(stat -c%s "$OUT" 2>/dev/null || echo "?")

    echo "$(date -Iseconds) OK file=$(basename "$IN") duration=${DURATION}s processed_in=${ELAPSED_MS}ms in_size=${IN_SIZE} out_size=${OUT_SIZE} model=$(basename "$RNNOISE_MODEL") mix=${RNNOISE_MIX}" \
        >> "$LOG_FILE"
else
    EXIT_CODE=$?
    echo "$(date -Iseconds) FAIL file=$(basename "$IN") duration=${DURATION}s exit_code=${EXIT_CODE} model=$(basename "$RNNOISE_MODEL") mix=${RNNOISE_MIX}" \
        >> "$LOG_FILE"

    if [[ "$FALLBACK_ON_FAIL" == "true" ]]; then
        echo "$(date -Iseconds) FALLBACK copying original to output: $(basename "$IN")" >> "$LOG_FILE"
        cp "$IN" "$OUT"
        exit 0
    fi

    exit "$EXIT_CODE"
fi
```

Make it executable:

```bash
sudo chmod +x /usr/local/bin/denoise-scribe-audio.sh
```

**Filter chain explanation:**
- `highpass=f=80` — Cuts sub-80Hz rumble (HVAC systems, building vibration). Speech fundamentals start around 85Hz for deep male voices, so this is safe.
- `arnndn=m=...:mix=0.85` — The neural denoiser. `mix=0.85` means 85% cleaned + 15% original, preserving natural voice texture. Increase toward 1.0 for more aggressive denoising; decrease toward 0.5 if voices sound "robotic."
- `acompressor` — Gentle 3:1 compression at -25dB. Evens out volume when patient speaks quietly and provider speaks loudly (or vice versa). The 5ms attack / 50ms release preserves speech transients.
- `loudnorm` — EBU R128 broadcast-standard normalization. Ensures every cleaned file hits the same perceived loudness (-16 LUFS), so the AI scribe gets consistent input levels regardless of mic distance or room acoustics.

---

### 4. Create the File Watcher Automation (systemd.path + systemd.service)

#### 4a. Create the processing wrapper script

Create `/usr/local/bin/scribe-denoise-watcher.sh`:

```bash
#!/usr/bin/env bash
# scribe-denoise-watcher.sh — Process all unprocessed files in /srv/scribe/incoming
# Called by systemd when new files appear. Idempotent — skips already-processed files.

set -euo pipefail

INCOMING_DIR="/srv/scribe/incoming"
CLEAN_DIR="/srv/scribe/clean"
LOCK_FILE="/tmp/scribe-denoise.lock"
LOG_FILE="/var/log/scribe-denoise.log"

# Prevent concurrent runs (systemd.path can re-trigger while processing)
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    echo "$(date -Iseconds) SKIP already running (lock held)" >> "$LOG_FILE"
    exit 0
fi

mkdir -p "$CLEAN_DIR"

# Process every file in incoming that doesn't have a cleaned counterpart
shopt -s nullglob
for INFILE in "$INCOMING_DIR"/*; do
    [[ -f "$INFILE" ]] || continue

    BASENAME=$(basename "$INFILE")
    EXTENSION="${BASENAME##*.}"
    NAME_NO_EXT="${BASENAME%.*}"

    # Skip temp files (partial uploads often end in .tmp, .part, or start with .)
    [[ "$BASENAME" == .* ]] && continue
    [[ "$EXTENSION" == "tmp" || "$EXTENSION" == "part" ]] && continue

    OUTFILE="$CLEAN_DIR/${NAME_NO_EXT}-clean.${EXTENSION}"

    # Idempotency: skip if clean version already exists
    if [[ -f "$OUTFILE" ]]; then
        continue
    fi

    # Wait for file to be fully written (check that size is stable for 2 seconds)
    PREV_SIZE=-1
    for i in {1..10}; do
        CURR_SIZE=$(stat -c%s "$INFILE" 2>/dev/null || echo 0)
        if [[ "$CURR_SIZE" -eq "$PREV_SIZE" && "$CURR_SIZE" -gt 0 ]]; then
            break
        fi
        PREV_SIZE="$CURR_SIZE"
        sleep 2
    done

    echo "$(date -Iseconds) START processing $(basename "$INFILE")" >> "$LOG_FILE"
    /usr/local/bin/denoise-scribe-audio.sh "$INFILE" "$OUTFILE"
done

# Release lock
flock -u 200
```

```bash
sudo chmod +x /usr/local/bin/scribe-denoise-watcher.sh
```

#### 4b. Create the systemd path unit

Create `/etc/systemd/system/scribe-denoise.path`:

```ini
[Unit]
Description=Watch /srv/scribe/incoming for new audio files

[Path]
DirectoryNotEmpty=/srv/scribe/incoming
# Also re-trigger when files are modified (covers overwritten uploads)
PathModified=/srv/scribe/incoming
# Throttle re-checks to avoid hammering during bulk uploads
MakeDirectory=yes

[Install]
WantedBy=multi-user.target
```

#### 4c. Create the systemd service unit

Create `/etc/systemd/system/scribe-denoise.service`:

```ini
[Unit]
Description=Denoise scribe audio files via RNNoise/ffmpeg
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/scribe-denoise-watcher.sh
User=ec2-user
Group=ec2-user

# Environment overrides (uncomment to customize)
# Environment=RNNOISE_MODEL=/srv/rnnoise-models/richardpl/sh.rnnn
# Environment=RNNOISE_MIX=0.9
# Environment=FALLBACK_ON_FAIL=true

# Resource limits
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=6
MemoryMax=512M
CPUQuota=80%

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=scribe-denoise

[Install]
WantedBy=multi-user.target
```

#### 4d. Enable and start

```bash
# Create directories with correct ownership
sudo mkdir -p /srv/scribe/incoming /srv/scribe/clean
sudo chown -R ec2-user:ec2-user /srv/scribe

# Create log file
sudo touch /var/log/scribe-denoise.log
sudo chown ec2-user:ec2-user /var/log/scribe-denoise.log

# Reload systemd and enable
sudo systemctl daemon-reload
sudo systemctl enable --now scribe-denoise.path

# Verify it's watching
sudo systemctl status scribe-denoise.path
```

---

### 5. Scribe Integration Point

My scribe service (Next.js API routes managed by PM2) currently reads uploaded audio from a directory and sends it to the AI transcription service. Here's how to integrate:

**Option A — Change the scribe's input directory (simplest):**
Wherever the scribe service reads files from the upload directory, change the path from `/srv/scribe/incoming` to `/srv/scribe/clean`. The cleaned files use the naming convention `{original-name}-clean.{ext}`.

**Option B — Create a filename resolver utility (if the scribe needs to map original → cleaned):**

Create `/usr/local/bin/resolve-clean-audio.sh`:

```bash
#!/usr/bin/env bash
# Given an original filename, returns the path to its cleaned version.
# Waits up to TIMEOUT seconds for the cleaned file to appear (processing may be in progress).
# Usage: resolve-clean-audio.sh <original-filename> [timeout-seconds]
#   e.g. resolve-clean-audio.sh visit-abc123.m4a 60

ORIGINAL="${1:?Usage: $0 <original-filename> [timeout]}"
TIMEOUT="${2:-120}"
CLEAN_DIR="/srv/scribe/clean"

BASENAME=$(basename "$ORIGINAL")
EXTENSION="${BASENAME##*.}"
NAME_NO_EXT="${BASENAME%.*}"
CLEAN_PATH="$CLEAN_DIR/${NAME_NO_EXT}-clean.${EXTENSION}"

ELAPSED=0
while [[ ! -f "$CLEAN_PATH" && "$ELAPSED" -lt "$TIMEOUT" ]]; do
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [[ -f "$CLEAN_PATH" ]]; then
    echo "$CLEAN_PATH"
    exit 0
else
    echo "TIMEOUT: cleaned file not ready after ${TIMEOUT}s" >&2
    exit 1
fi
```

**Option C — Node.js helper for your Next.js API routes:**

If the scribe is triggered from a Next.js API route, add this helper to your codebase:

```typescript
// lib/audio-denoise.ts
import { existsSync } from 'fs';
import path from 'path';

const CLEAN_DIR = '/srv/scribe/clean';
const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 120_000; // 2 minutes

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
```

Then in your scribe API route:

```typescript
import { resolveCleanAudio } from '@/lib/audio-denoise';

// Inside your route handler, after file upload completes:
const cleanedPath = await resolveCleanAudio(uploadedFilename);
// Pass cleanedPath to your AI scribe service instead of the original
```

---

### 6. Logging, Observability, and Log Rotation

The log at `/var/log/scribe-denoise.log` will contain structured entries like:

```
2026-03-19T16:30:45+00:00 OK file=visit-abc123.m4a duration=847.3s processed_in=12340ms in_size=6842880 out_size=5491200 model=bd.rnnn mix=0.85
2026-03-19T16:31:02+00:00 FAIL file=corrupt-upload.m4a duration=unknown exit_code=1 model=bd.rnnn mix=0.85
```

Add log rotation to prevent unbounded growth. Create `/etc/logrotate.d/scribe-denoise`:

```
/var/log/scribe-denoise.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 ec2-user ec2-user
}
```

To tail the log in real time:

```bash
tail -f /var/log/scribe-denoise.log
```

To check systemd journal for the service:

```bash
journalctl -u scribe-denoise.service -f
```

---

### 7. Tuning Guide — Changing Model or Mix Later

**To change the noise reduction strength (mix parameter):**

Edit `/etc/systemd/system/scribe-denoise.service` and uncomment/add:
```ini
Environment=RNNOISE_MIX=0.9
```

| Mix Value | Effect |
|---|---|
| `1.0` | Maximum denoising — may sound slightly processed/metallic |
| `0.85` | **Default** — strong denoising, natural voice preserved |
| `0.7` | Moderate — good if voices already sound a bit robotic |
| `0.5` | Light — background noise reduced but still audible |
| `0.0` | No denoising (passthrough, only highpass/compression/loudnorm applied) |

**To switch the RNNoise model:**

Update the symlink:
```bash
# For strictest speech-only (removes coughs, laughs, throat clearing):
sudo ln -sf /srv/rnnoise-models/richardpl/sh.rnnn /srv/rnnoise-models/active-model.rnnn

# For original Xiph model (general purpose):
sudo ln -sf /srv/rnnoise-models/richardpl/std.rnnn /srv/rnnoise-models/active-model.rnnn

# For indoor recording with all sounds preserved:
sudo ln -sf /srv/rnnoise-models/richardpl/cb.rnnn /srv/rnnoise-models/active-model.rnnn
```

Or override in the systemd service:
```ini
Environment=RNNOISE_MODEL=/srv/rnnoise-models/richardpl/sh.rnnn
```

After any change, restart:
```bash
sudo systemctl daemon-reload
# New files will automatically use the new settings; no service restart needed
# since scribe-denoise.service is Type=oneshot triggered by the .path unit.
```

**To disable the extra filter stages** (if you only want RNNoise, no highpass/compression/loudnorm):

Edit `denoise-scribe-audio.sh` and change the `FILTER_CHAIN` variable to:
```bash
FILTER_CHAIN="arnndn=m='${RNNOISE_MODEL}':mix=${RNNOISE_MIX}"
```

---

### 8. Quick Smoke Test

After everything is installed:

```bash
# Drop a test file into incoming
cp /path/to/any-test-audio.m4a /srv/scribe/incoming/test-recording.m4a

# Watch for processing
tail -f /var/log/scribe-denoise.log

# After a few seconds, check for the cleaned file
ls -la /srv/scribe/clean/
# Should see: test-recording-clean.m4a

# Listen to compare (if you have a desktop or scp the files)
ffplay /srv/scribe/incoming/test-recording.m4a   # original
ffplay /srv/scribe/clean/test-recording-clean.m4a # cleaned
```

---

## Summary of Files Created

| File | Purpose |
|---|---|
| `/usr/local/bin/denoise-scribe-audio.sh` | Core denoising script (ffmpeg + RNNoise) |
| `/usr/local/bin/scribe-denoise-watcher.sh` | Batch processor with idempotency and file locking |
| `/usr/local/bin/resolve-clean-audio.sh` | Filename resolver for scribe integration |
| `/etc/systemd/system/scribe-denoise.path` | Watches incoming directory for new files |
| `/etc/systemd/system/scribe-denoise.service` | Triggers watcher script on file events |
| `/etc/logrotate.d/scribe-denoise` | Log rotation config |
| `/srv/rnnoise-models/active-model.rnnn` | Symlink to active RNNoise model |
| `lib/audio-denoise.ts` | Node.js helper for Next.js API route integration |

Assume I am comfortable editing config files and restarting services, but generate production-ready code and configuration that I can copy-paste with minimal modification. My PM2 services run as `ec2-user`, my app is at `/home/ec2-user/gmhdashboard`, and the dashboard is accessed at `https://www.nowoptimal.com/ops/`.
