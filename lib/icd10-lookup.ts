import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const S3_BUCKET = 'gmh-clinical-data-lake';
const S3_KEY = 'reference/icd10-codes.json';

interface ICD10Entry {
    code: string;
    description: string;
}

// In-memory cache — loaded once per process lifetime
let codeMap: Map<string, string> | null = null;
let allCodes: ICD10Entry[] | null = null;

async function ensureLoaded(): Promise<void> {
    if (codeMap) return;

    try {
        const s3 = new S3Client({ region: 'us-east-2' });
        const response = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: S3_KEY }));
        const body = await response.Body?.transformToString();
        if (!body) throw new Error('Empty S3 response');

        const entries: ICD10Entry[] = JSON.parse(body);
        codeMap = new Map(entries.map(e => [e.code, e.description]));
        allCodes = entries;
        console.log(`[ICD10] Loaded ${codeMap.size} codes from S3`);
    } catch (err) {
        console.error('[ICD10] Failed to load from S3, using empty database:', err instanceof Error ? err.message : err);
        codeMap = new Map();
        allCodes = [];
    }
}

/** Validate an ICD-10 code against the database */
export async function validateICD10(code: string): Promise<{ valid: boolean; description: string }> {
    await ensureLoaded();
    const desc = codeMap!.get(code);
    return desc ? { valid: true, description: desc } : { valid: false, description: '' };
}

/** Look up the description for a code, or null if not found */
export async function lookupDescription(code: string): Promise<string | null> {
    await ensureLoaded();
    return codeMap!.get(code) || null;
}

/** Search codes by keyword (description or code) */
export async function searchCodes(query: string, limit = 20): Promise<ICD10Entry[]> {
    await ensureLoaded();
    const q = query.toLowerCase();
    return (allCodes || [])
        .filter(e => e.description.toLowerCase().includes(q) || e.code.toLowerCase().includes(q))
        .slice(0, limit);
}

/** Validate an array of codes, returning each with verified status */
export async function validateCodeBatch(codes: Array<{ code: string; description: string }>): Promise<Array<{ code: string; description: string; verified: boolean }>> {
    await ensureLoaded();
    return codes.map(c => {
        const verifiedDesc = codeMap!.get(c.code);
        return {
            code: c.code,
            // Use verified description if available, fall back to AI-provided description
            description: verifiedDesc || c.description || c.code,
            verified: !!verifiedDesc,
        };
    });
}
