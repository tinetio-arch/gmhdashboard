# Patient Portal & Photo Upload - Implementation Plan

## Overview

This document outlines two related features:
1. **Simplified Photo Upload** - Easy way for staff to add patient photos
2. **Patient Portal** - Self-service portal where patients can login, view their data, and upload photos

---

## Part 1: Simplified Photo Upload for Staff

### 1.1 Current Plan vs. Simplified Approach

**Current Plan** (from SCANNER_WORKFLOW_AND_INTEGRATION.md):
- Photo upload via patient profile page
- File system storage
- Multiple photo types (profile, license, etc.)

**Simplified Approach** (Recommended):
- **Quick Upload Button** on patient profile page
- **Drag-and-drop** or click to upload
- **Auto-crop/resize** to standard size (e.g., 300x300px)
- **Instant preview** before saving
- **One-click save** - minimal steps

### 1.2 Implementation Approach

#### Option A: Simple File Upload (Recommended for MVP)
```
Patient Profile Page
  └─> [Upload Photo] button
       └─> File picker opens
            └─> Select image
                 └─> Auto-resize/crop
                      └─> Preview
                           └─> [Save] → Done!
```

**Features**:
- Single file input
- Client-side image resizing (using browser Canvas API)
- Upload to `/public/patient-photos/[patient_id]/profile.jpg`
- Update database with photo URL
- Replace existing photo if one exists

**Pros**:
- Very simple to implement
- No external dependencies
- Fast workflow for staff
- Works immediately

**Cons**:
- No advanced editing (crop, rotate)
- Single photo per patient (can enhance later)

#### Option B: Advanced Upload with Editing
- Use a library like `react-image-crop` or `react-easy-crop`
- Allow staff to crop/rotate before saving
- More control, but more complex

**Recommendation**: Start with **Option A**, add editing later if needed.

### 1.3 Technical Implementation

#### 1.3.1 Component: `SimplePhotoUpload.tsx`

```typescript
'use client';

import { useState } from 'react';

type Props = {
  patientId: string;
  currentPhotoUrl?: string | null;
  onUploadComplete: (photoUrl: string) => void;
};

export default function SimplePhotoUpload({ patientId, currentPhotoUrl, onUploadComplete }: Props) {
  const [preview, setPreview] = useState<string | null>(currentPhotoUrl ?? null);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB');
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Resize image
    const resized = await resizeImage(file, 300, 300);
    
    // Upload
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('photo', resized, 'profile.jpg');
      
      const response = await fetch(`/api/patients/${patientId}/photos`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) throw new Error('Upload failed');
      
      const data = await response.json();
      onUploadComplete(data.photoUrl);
      setUploading(false);
    } catch (error) {
      alert('Failed to upload photo');
      setUploading(false);
    }
  };

  return (
    <div>
      {preview && (
        <img src={preview} alt="Patient photo" style={{ width: 150, height: 150, borderRadius: '50%', objectFit: 'cover' }} />
      )}
      <input
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        disabled={uploading}
        style={{ display: 'none' }}
        id="photo-upload"
      />
      <label htmlFor="photo-upload" style={{ cursor: 'pointer', padding: '0.5rem 1rem', backgroundColor: '#0284c7', color: 'white', borderRadius: '0.5rem' }}>
        {uploading ? 'Uploading...' : preview ? 'Change Photo' : 'Upload Photo'}
      </label>
    </div>
  );
}

// Helper function to resize image
async function resizeImage(file: File, maxWidth: number, maxHeight: number): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Calculate new dimensions
      if (width > height) {
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob((blob) => {
        resolve(blob || file);
      }, 'image/jpeg', 0.9);
    };
    img.src = URL.createObjectURL(file);
  });
}
```

#### 1.3.2 API Endpoint: `POST /api/patients/[id]/photos`

```typescript
// app/api/patients/[id]/photos/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  await requireApiUser(request, 'write');
  
  const patientId = params.id;
  const formData = await request.formData();
  const file = formData.get('photo') as File;
  
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  // Create directory if it doesn't exist
  const photoDir = join(process.cwd(), 'public', 'patient-photos', patientId);
  await mkdir(photoDir, { recursive: true });

  // Save file
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const filename = 'profile.jpg';
  const filepath = join(photoDir, filename);
  await writeFile(filepath, buffer);

  // Update database
  const photoUrl = `/patient-photos/${patientId}/${filename}`;
  await query(
    `INSERT INTO patient_photos (patient_id, photo_type, photo_url, is_primary, uploaded_by)
     VALUES ($1, 'profile', $2, TRUE, $3)
     ON CONFLICT (patient_id, is_primary) WHERE is_primary = TRUE
     DO UPDATE SET photo_url = $2, uploaded_at = NOW()`,
    [patientId, photoUrl, user.user_id]
  );

  return NextResponse.json({ success: true, photoUrl });
}
```

### 1.4 Integration with Patient Profile

Add to `app/patients/[id]/page.tsx`:

```typescript
// At the top of the patient info section
<div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
  <SimplePhotoUpload 
    patientId={patient.patient_id}
    currentPhotoUrl={patientPhotoUrl}
    onUploadComplete={(url) => {
      // Refresh page or update state
      window.location.reload();
    }}
  />
  <div>
    <h1>{patient.patient_name}</h1>
    {/* Rest of patient info */}
  </div>
</div>
```

---

## Part 2: Patient Portal Application

### 2.1 Overview

A separate patient-facing application where patients can:
- **Login** with email/password (separate from staff auth)
- **View their dispense history**
- **View their payment history** (QuickBooks invoices, payments)
- **Upload/update their profile photo**
- **View upcoming lab dates**
- **View their regimen**
- **Update contact information** (optional)

### 2.2 Architecture Decision

#### Option A: Separate Patient Portal (Recommended)
- **Separate route**: `/patient-portal` or `/my-account`
- **Separate authentication**: `patient_accounts` table
- **Separate UI**: Patient-friendly design, mobile-responsive
- **Same database**: Shares `patients`, `dispenses`, `financials` tables

**Pros**:
- Clear separation of concerns
- Different UI/UX for patients vs. staff
- Can be deployed separately if needed
- Easier to secure (patient-only routes)

**Cons**:
- More code to maintain
- Need to duplicate some queries

#### Option B: Integrated Portal
- Same app, different routes
- Role-based access (`patient` role)
- Conditional UI based on role

**Pros**:
- Single codebase
- Shared components

**Cons**:
- More complex routing
- Harder to customize patient experience
- Security concerns (accidental access to staff features)

**Recommendation**: **Option A - Separate Patient Portal**

### 2.3 Database Schema

#### 2.3.1 Patient Accounts Table

```sql
CREATE TABLE IF NOT EXISTS patient_accounts (
    account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL UNIQUE REFERENCES patients(patient_id) ON DELETE CASCADE,
    
    -- Authentication
    email TEXT NOT NULL UNIQUE, -- Must match patient email or be verified
    password_hash TEXT NOT NULL,
    
    -- Account Status
    is_active BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE, -- Email verification
    verification_token TEXT,
    verification_expires_at TIMESTAMP,
    
    -- Password Reset
    reset_token TEXT,
    reset_expires_at TIMESTAMP,
    
    -- Security
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    last_login_at TIMESTAMP,
    
    -- Preferences
    email_notifications BOOLEAN DEFAULT TRUE,
    sms_notifications BOOLEAN DEFAULT FALSE,
    
    -- Audit
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT email_matches_patient CHECK (
        email = (SELECT email FROM patients WHERE patient_id = patient_accounts.patient_id)
        OR is_verified = TRUE
    )
);

CREATE INDEX IF NOT EXISTS idx_patient_accounts_email ON patient_accounts(email);
CREATE INDEX IF NOT EXISTS idx_patient_accounts_patient ON patient_accounts(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_accounts_verification ON patient_accounts(verification_token) WHERE verification_token IS NOT NULL;
```

#### 2.3.2 Patient Sessions Table

```sql
CREATE TABLE IF NOT EXISTS patient_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES patient_accounts(account_id) ON DELETE CASCADE,
    session_token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_sessions_account ON patient_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_patient_sessions_token ON patient_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_patient_sessions_expires ON patient_sessions(expires_at);
```

### 2.4 Patient Portal Features

#### 2.4.1 Dashboard/Home Page
```
┌─────────────────────────────────────────┐
│  Welcome, [Patient Name]                │
│  ─────────────────────────────────────  │
│                                         │
│  [Patient Photo]                        │
│                                         │
│  Quick Stats:                           │
│  • Next Lab: [Date]                     │
│  • Last Dispense: [Date]                │
│  • Balance Owed: $[Amount]              │
│                                         │
│  [View Dispense History]                │
│  [View Payment History]                 │
│  [Update Profile]                       │
└─────────────────────────────────────────┘
```

#### 2.4.2 Dispense History Page
- List of all dispenses for patient
- Date, medication, volume, vial ID
- Sortable, filterable
- Export to PDF (optional)

#### 2.4.3 Payment History Page
- QuickBooks invoices
- Payment history
- Balance owed
- Payment method
- Download receipts (if available)

#### 2.4.4 Profile Page
- View/edit contact information
- Upload/change profile photo
- View/update driver's licenses (if we add this)
- Change password
- Notification preferences

### 2.5 Authentication Flow

#### 2.5.1 Account Creation

**Option 1: Staff-Initiated** (Recommended)
1. Staff creates account for patient from patient profile page
2. System sends email with setup link
3. Patient clicks link, sets password
4. Account activated

**Option 2: Self-Registration**
1. Patient visits portal, clicks "Sign Up"
2. Enters email (must match patient record)
3. System sends verification email
4. Patient verifies email, sets password
5. Account linked to patient record

**Recommendation**: **Option 1** - Staff-initiated for security and control

#### 2.5.2 Login Flow

```
Patient Portal Login
  └─> Enter email + password
       └─> Verify credentials
            └─> Check account status (active, not locked)
                 └─> Create session
                      └─> Redirect to dashboard
```

### 2.6 Security Considerations

#### 2.6.1 Data Access Control
- Patients can **ONLY** see their own data
- All queries must filter by `patient_id` from session
- No access to other patients' data
- No access to staff/admin features

#### 2.6.2 API Security
```typescript
// Example: Get patient's dispense history
export async function GET(request: NextRequest) {
  const patient = await requirePatientAuth(request);
  
  // Automatically filter by patient_id
  const dispenses = await query(
    `SELECT * FROM dispenses 
     WHERE patient_id = $1 
     ORDER BY dispense_date DESC`,
    [patient.patient_id] // From authenticated session
  );
  
  return NextResponse.json({ dispenses });
}
```

#### 2.6.3 Rate Limiting
- Limit login attempts (prevent brute force)
- Lock account after X failed attempts
- Require email verification for password reset

#### 2.6.4 HIPAA Compliance
- All data encrypted in transit (HTTPS)
- Audit logs for patient access
- Secure session management
- No PHI in URLs or logs

### 2.7 Implementation Structure

```
gmh-dashboard/
├── app/
│   ├── patient-portal/          # New patient portal routes
│   │   ├── login/
│   │   │   └── page.tsx
│   │   ├── dashboard/
│   │   │   └── page.tsx
│   │   ├── dispenses/
│   │   │   └── page.tsx
│   │   ├── payments/
│   │   │   └── page.tsx
│   │   ├── profile/
│   │   │   └── page.tsx
│   │   └── layout.tsx           # Patient portal layout
│   │
│   └── api/
│       └── patient-portal/      # Patient portal APIs
│           ├── auth/
│           │   ├── login/route.ts
│           │   ├── logout/route.ts
│           │   └── register/route.ts
│           ├── dispenses/route.ts
│           ├── payments/route.ts
│           └── profile/route.ts
│
├── lib/
│   ├── patientAuth.ts           # Patient authentication
│   └── patientPortal.ts         # Patient portal queries
│
└── components/
    └── patient-portal/          # Patient portal components
        ├── PatientDashboard.tsx
        ├── DispenseHistory.tsx
        ├── PaymentHistory.tsx
        └── PatientProfile.tsx
```

### 2.8 UI/UX Design

#### 2.8.1 Design Principles
- **Patient-Friendly**: Simple, clear language (no medical jargon)
- **Mobile-First**: Responsive design for phones/tablets
- **Accessible**: WCAG 2.1 AA compliance
- **Fast**: Quick page loads, minimal clicks

#### 2.8.2 Color Scheme
- Different from staff dashboard (e.g., softer colors)
- Professional but approachable
- High contrast for readability

#### 2.8.3 Navigation
- Simple top navigation
- Clear call-to-action buttons
- Breadcrumbs for deep pages
- Mobile hamburger menu

### 2.9 Integration with Existing System

#### 2.9.1 Staff Side: Create Patient Account
Add to patient profile page (`/patients/[id]`):

```typescript
// New section: Patient Portal Access
<div>
  <h3>Patient Portal</h3>
  {patientAccount ? (
    <div>
      <p>Account Status: {patientAccount.is_active ? 'Active' : 'Inactive'}</p>
      <p>Last Login: {formatDate(patientAccount.last_login_at)}</p>
      <button onClick={sendPortalLink}>Send Portal Link</button>
      <button onClick={resetPassword}>Reset Password</button>
    </div>
  ) : (
    <div>
      <p>No patient portal account</p>
      <button onClick={createAccount}>Create Account</button>
    </div>
  )}
</div>
```

#### 2.9.2 Data Sharing
- Patient portal reads from same tables:
  - `patients` - Patient info
  - `dispenses` - Dispense history
  - `dea_transactions` - DEA records (read-only)
  - QuickBooks data (via existing API)
- Uses existing queries, filtered by `patient_id`

### 2.10 Email Notifications

#### 2.10.1 Account Setup Email
```
Subject: Your Patient Portal Account

Hi [Patient Name],

A patient portal account has been created for you. Click the link below to set up your password:

[Setup Link]

This link expires in 24 hours.

If you didn't request this, please contact us.
```

#### 2.10.2 Password Reset Email
```
Subject: Reset Your Patient Portal Password

Hi [Patient Name],

Click the link below to reset your password:

[Reset Link]

This link expires in 1 hour.
```

### 2.11 Implementation Phases

#### Phase 1: Foundation (Week 1)
- [ ] Database schema (patient_accounts, patient_sessions)
- [ ] Patient authentication system
- [ ] Login/logout pages
- [ ] Basic dashboard

#### Phase 2: Core Features (Week 2)
- [ ] Dispense history page
- [ ] Payment history page
- [ ] Profile page with photo upload
- [ ] Account management

#### Phase 3: Enhanced Features (Week 3)
- [ ] Email notifications
- [ ] Password reset flow
- [ ] Mobile optimization
- [ ] Export functionality

#### Phase 4: Staff Integration (Week 3-4)
- [ ] Staff UI to create patient accounts
- [ ] Send portal links
- [ ] View patient portal activity
- [ ] Account management tools

---

## Part 3: Combined Approach - Best of Both Worlds

### 3.1 Recommended Implementation Order

1. **Start with Simple Photo Upload** (1-2 days)
   - Quick win for staff
   - Immediate value
   - Low risk

2. **Build Patient Portal MVP** (2-3 weeks)
   - Authentication
   - Dashboard
   - Dispense history
   - Payment history

3. **Enhance Photo Upload** (ongoing)
   - Patient can upload their own photo via portal
   - Staff can still upload from admin side
   - Sync between both

### 3.2 Benefits of Combined Approach

- **Staff Efficiency**: Quick photo upload saves time
- **Patient Engagement**: Portal gives patients access to their data
- **Reduced Support**: Patients can check their own history
- **Better Experience**: Patients feel more connected to their care

---

## Part 4: Technical Considerations

### 4.1 Photo Storage Strategy

**Current Plan**: File system (`/public/patient-photos/`)

**Considerations**:
- **Backup**: Include in regular backups
- **CDN**: Consider CloudFront/S3 for production
- **Permissions**: Ensure proper file permissions
- **Cleanup**: Remove photos when patient is deleted

### 4.2 Patient Portal Hosting

**Option A: Same Domain** (Recommended)
- `nowoptimal.com/patient-portal`
- Same SSL certificate
- Same infrastructure
- Easier to manage

**Option B: Subdomain**
- `portal.nowoptimal.com`
- Separate SSL
- Can scale independently
- More complex setup

**Recommendation**: **Option A** - Same domain for simplicity

### 4.3 Performance

- **Caching**: Cache patient data (with invalidation)
- **Pagination**: Paginate dispense/payment history
- **Lazy Loading**: Load photos on demand
- **CDN**: Use CDN for static assets

---

## Part 5: Security Checklist

### 5.1 Authentication
- [ ] Strong password requirements (min 8 chars, complexity)
- [ ] Rate limiting on login attempts
- [ ] Account lockout after failed attempts
- [ ] Secure session tokens (HTTP-only cookies)
- [ ] Session expiration (e.g., 30 days)

### 5.2 Data Access
- [ ] All queries filter by authenticated patient_id
- [ ] No patient can access another patient's data
- [ ] Staff routes completely separate from patient routes
- [ ] API endpoints validate patient authentication

### 5.3 Data Protection
- [ ] HTTPS only (no HTTP)
- [ ] Encrypt sensitive data at rest
- [ ] Audit logs for all patient access
- [ ] Regular security audits

---

## Part 6: Cost/Benefit Analysis

### 6.1 Photo Upload (Simple)
- **Development Time**: 1-2 days
- **Maintenance**: Low
- **Value**: High (staff efficiency)
- **Risk**: Low

### 6.2 Patient Portal
- **Development Time**: 2-3 weeks
- **Maintenance**: Medium (ongoing support)
- **Value**: Very High (patient engagement, reduced support)
- **Risk**: Medium (security, HIPAA compliance)

### 6.3 ROI
- **Reduced Support Calls**: Patients can check their own data
- **Better Patient Experience**: More engaged patients
- **Staff Time Savings**: Less time answering "when was my last dispense?"
- **Competitive Advantage**: Modern patient portal

---

## Part 7: Questions & Decisions

### 7.1 Photo Upload
- [ ] **Simple upload** (recommended) or advanced editing?
- [ ] **File size limit**? (Recommend 5MB)
- [ ] **Photo dimensions**? (Recommend 300x300px)
- [ ] **Allow patients to upload** via portal? (Yes, recommended)

### 7.2 Patient Portal
- [ ] **Self-registration** or staff-initiated only? (Recommend staff-initiated)
- [ ] **Email verification required**? (Yes, recommended)
- [ ] **Two-factor authentication**? (Optional, for future)
- [ ] **What data to show**? (Dispenses, payments, labs - recommended)
- [ ] **Allow patients to update info**? (Contact info - yes, medical - no)

### 7.3 Integration
- [ ] **Same app** or separate deployment? (Same app, recommended)
- [ ] **Same domain** or subdomain? (Same domain, recommended)
- [ ] **Shared authentication** or separate? (Separate, recommended)

---

## Next Steps

1. **Review this plan** and make decisions on open questions
2. **Start with simple photo upload** (quick win)
3. **Design patient portal UI/UX** (mockups)
4. **Implement patient authentication** (foundation)
5. **Build portal features** (iteratively)
6. **Test security** (thoroughly)
7. **Launch** (with monitoring)

---

**Document Version**: 1.0  
**Created**: 2024-01-XX  
**Last Updated**: 2024-01-XX

