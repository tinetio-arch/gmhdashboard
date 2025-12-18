# Heidi Widget & API Integration Guide

This repo now includes the plumbing you need to embed Heidi directly within your Healthie-based workflows. Use this document as the checklist for enabling Heidi end-to-end.

> Official docs: [Heidi Open API & widget](https://www.heidihealth.com/developers/heidi-api/overview)

---

## 1. Configure Environment Variables

Add the following to `.env.local` (already added to `env.example`):

```bash
HEIDI_API_KEY=your_heidi_api_key
HEIDI_API_BASE_URL=https://registrar.api.heidihealth.com/api/v2/ml-scribe/open-api/
NEXT_PUBLIC_HEIDI_WIDGET_URL=https://widget.heidihealth.com/sdk.js
```

- `HEIDI_API_KEY`: server-side key for the Open API (session mgmt, fetching notes).
- `NEXT_PUBLIC_HEIDI_WIDGET_URL`: client-side widget script URL (can be overridden if Heidi changes the CDN location).

Restart `next dev` after updating env vars.

---

## 2. Server-Side API Client (`lib/heidi.ts`)

Use `createHeidiClient()` whenever you need to interact with Heidi’s REST endpoints (transcription + consult notes). Available helpers:

- `createSession({ patientId, providerId, templateId? })`
- `appendContext(sessionId, context)`
- `publishTranscription(sessionId, { text })`
- `fetchConsultNote(sessionId)`

```ts
import { createHeidiClient } from '@/lib/heidi';

const heidi = createHeidiClient();
if (!heidi) throw new Error('Heidi missing');

const session = await heidi.createSession({
  patientId: 'PT-123',
  providerId: 'DR-42',
  templateId: 'primary-care',
});
```

Pending work:
- Map Heidi consult notes into Healthie via `clinicalService.attachHeidiNote`.
- Capture all imports with `auditService.logEvent`.

---

## 3. Client-Side Widget (`components/HeidiWidget.tsx`)

Rendering the widget is as simple as:

```tsx
import { HeidiWidget } from '@/components/HeidiWidget';

export function VisitNotePanel({ heidiToken, patient }) {
  return (
    <HeidiWidget
      token={heidiToken}
      patient={{ id: patient.patientId, name: patient.fullName, dob: patient.dob ?? undefined }}
      templateId="primary-care"
      onNoteReady={(payload) => console.log('Note ready', payload)}
    />
  );
}
```

Props:
- `token`: short-lived widget token issued by Heidi (generated per provider/session).
- `patient`: `{ id, name, dob? }`.
- `templateId`, `notesEnabled`, `onNoteReady` mirror Heidi’s widget options.

The component:
- Loads the widget script once (`NEXT_PUBLIC_HEIDI_WIDGET_URL`).
- Creates/destroys the widget instance automatically when props change/unmount.
- Provides a neutral container you can drop into any Next.js page/panel.

> You still need to obtain a widget token from Heidi’s backend. Typically you’ll call Heidi’s auth endpoint on the server and return the token to the browser when rendering the page.

---

## 4. Suggested Workflow

1. **Start visit**: provider opens the Heidi widget inside your Healthie custom page. Widget handles voice capture + live note.
2. **Note ready callback**: via `onNoteReady`, call your own API route to:
   - Store the note via `createHeidiClient().fetchConsultNote`.
   - Attach the note/doc to Healthie (GraphQL mutation).
   - Trigger downstream automations (labs, messages).
3. **Audit log**: call `auditService.logEvent({ system: 'HEALTHIE', action: 'heidi_note_attached', ... })`.

---

## 5. Remaining Integrations (next tasks)

- **Token minting**: add a server route that exchanges provider credentials for a widget token (per Heidi docs).
- **Attach notes to Healthie**: wire `clinicalService.attachHeidiNote` to store Heidi’s consult note as a Healthie document/chart note.
- **Automation hooks**: when Heidi surfaces orders (labs, Rx, tasks), map them into the existing Healthie/GoHighLevel tooling.

With the server client + React widget in place, the rest is wiring up your auth/token flow and Healthie mutations. Refer to Heidi’s official documentation for exact token scopes and session endpoints.


