# GMH Dashboard (Next.js)

A lightweight replacement for the Google Sheets workflow. It reads and writes
against the same PostgreSQL database used by the loader scripts.

## Prerequisites
- Node.js 18.17+ (matches the Next.js requirement)
- Yarn or npm (examples use `npm`)
- Environment variables pointing at the RDS instance (see `env.example`).

## Getting started
```bash
cd "$(pwd)/gmh-dashboard"
cp env.example .env.local  # update values before running
npm install
npm run dev
```

Open <http://localhost:3000>. You should see:
- **Dashboard** – summary metrics from `professional_patient_dashboard_v`
- **Patients** – filter, edit, and save directly to `patients`
- **DEA Log** – review recent controlled dispenses and export CSV
- **Inventory** – monitor vial stock and expirations
- **Provider Signatures** – routed queue for prescribing providers to attest dispenses
- **Audits** – weekly inventory review log that satisfies DEA record keeping

## Deployment
- For Vercel: add the environment variables in the project settings and run
  `vercel --prod`.
- For EC2/self-hosting: run `npm run build` then `npm start`. Because the
  project exports a standalone build, you can copy `.next/standalone` and the
  `public/` directory to a minimal Node.js runtime.

## Security notes
- Rotate the leaked IAM keys and store new ones in AWS Secrets Manager.
- Create a least-privileged database role for the app (SELECT/UPDATE on
  relevant tables, EXECUTE on views).
- Use HTTPS when exposing the dashboard externally.

## Alerts & exports
- Low-inventory notifications fire when active testosterone vials drop below the
  configured threshold. Configure these environment variables:
  - `CONTROLLED_VIAL_THRESHOLD` (default `10`)
  - `INVENTORY_ALERT_RECIPIENTS` (comma-separated emails)
  - `INVENTORY_ALERT_SENDER`
  - `AWS_SES_REGION` (or `AWS_REGION`)
- DEA log exports stream to S3 on-demand (or via cron hitting
  `POST /api/exports/dea`). Configure:
  - `DEA_EXPORT_BUCKET`
  - `DEA_EXPORT_PREFIX` (optional, default `dea-exports`)
  - `DEA_EXPORT_TOKEN` (optional API key for cron access)
  - `AWS_S3_REGION` (or `AWS_REGION`)

For scheduled exports, point a weekly cron (e.g., AWS EventBridge or crontab) at
`POST /ops/api/exports/dea` with appropriate authentication.
