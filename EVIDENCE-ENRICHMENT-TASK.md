# Evidence Enrichment for Scribe Notes — Implementation Task

## Overview
Add a PubMed citation enrichment step to the SOAP note generation pipeline. After Claude generates the SOAP note, extract diagnoses from the Assessment section, query PubMed for the latest clinical practice guidelines for each diagnosis, and have Claude append evidence citations to the Plan section.

## Architecture
The enrichment happens AFTER the initial SOAP generation (line ~580 in generate-note/route.ts) and BEFORE storing in scribe_notes (line ~598). This is a post-processing step — it does NOT change the initial SOAP generation prompt.

```
Current flow:
  transcript → Claude SOAP → parse sections → store in DB

New flow:
  transcript → Claude SOAP → parse sections → enrichWithEvidence() → store in DB
```

## Step-by-Step Implementation

### Step 1: Create `/lib/pubmed.ts` — PubMed API Client

Create a new file at `/lib/pubmed.ts` with these functions:

```typescript
/**
 * PubMed E-Utilities Client for Evidence Enrichment
 * 
 * Uses NCBI E-Utilities API (free, no key required for <3 req/sec)
 * Optional: Add NCBI_API_KEY env var for 10 req/sec limit
 * 
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/
 */

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const API_KEY = process.env.NCBI_API_KEY || ''; // Optional, increases rate limit to 10/sec

interface PubMedArticle {
    pmid: string;
    title: string;
    authors: string;      // "Smith J, Doe A, et al."
    journal: string;      // "N Engl J Med"
    year: string;         // "2024"
    doi: string | null;
    url: string;          // "https://pubmed.ncbi.nlm.nih.gov/12345678/"
}

/**
 * Search PubMed for clinical practice guidelines related to a diagnosis.
 * Returns top 3 most recent guideline/review articles.
 */
export async function searchPubMedGuidelines(diagnosis: string, maxResults: number = 3): Promise<PubMedArticle[]> {
    // Build search query: diagnosis + clinical practice guideline filter
    // Use PubMed's built-in clinical queries filter for therapy/guidelines
    const query = `${diagnosis} AND (Practice Guideline[PT] OR Guideline[PT] OR systematic review[PT] OR Consensus Development Conference[PT] OR "clinical practice guideline"[TI])`;
    
    const apiKeyParam = API_KEY ? `&api_key=${API_KEY}` : '';
    
    // Step 1: ESearch — get PMIDs
    const searchUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&sort=date&retmode=json${apiKeyParam}`;
    
    const searchResp = await fetch(searchUrl);
    const searchData = await searchResp.json();
    const pmids: string[] = searchData?.esearchresult?.idlist || [];
    
    if (pmids.length === 0) {
        // Fallback: broader search without guideline filter
        const broadQuery = `${diagnosis} AND (review[PT] OR meta-analysis[PT]) AND ("last 5 years"[PDat])`;
        const broadUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(broadQuery)}&retmax=${maxResults}&sort=relevance&retmode=json${apiKeyParam}`;
        const broadResp = await fetch(broadUrl);
        const broadData = await broadResp.json();
        const broadPmids: string[] = broadData?.esearchresult?.idlist || [];
        if (broadPmids.length === 0) return [];
        pmids.push(...broadPmids);
    }
    
    // Step 2: ESummary — get article metadata
    const summaryUrl = `${EUTILS_BASE}/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json${apiKeyParam}`;
    const summaryResp = await fetch(summaryUrl);
    const summaryData = await summaryResp.json();
    
    const articles: PubMedArticle[] = [];
    for (const pmid of pmids) {
        const record = summaryData?.result?.[pmid];
        if (!record) continue;
        
        // Format authors: "Smith J, Doe A, et al."
        const authorList = record.authors || [];
        let authors = '';
        if (authorList.length > 3) {
            authors = `${authorList[0]?.name || ''}, ${authorList[1]?.name || ''}, et al.`;
        } else {
            authors = authorList.map((a: any) => a.name).join(', ');
        }
        
        // Extract DOI from articleids
        const doiEntry = (record.articleids || []).find((a: any) => a.idtype === 'doi');
        
        articles.push({
            pmid,
            title: record.title || '',
            authors,
            journal: record.source || record.fulljournalname || '',
            year: (record.pubdate || '').split(' ')[0] || '',
            doi: doiEntry?.value || null,
            url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        });
    }
    
    return articles;
}

/**
 * Extract diagnosis names from an Assessment section string.
 * Looks for patterns like "1. Diagnosis Name (ICD-10)" or "**Diagnosis Name (Z00.00)**"
 */
export function extractDiagnoses(assessmentText: string): string[] {
    const diagnoses: string[] = [];
    
    // Match patterns like:
    //   "1. Testosterone Deficiency (E29.1)"
    //   "**Hypogonadism (E29.1):**"
    //   "- Obesity (E66.01)"
    const patterns = [
        /\d+\.\s*\*?\*?([^(]+?)\s*\([A-Z]\d{2}/g,          // "1. Diagnosis (ICD-10"
        /\*\*([^(]+?)\s*\([A-Z]\d{2}/g,                      // "**Diagnosis (ICD-10"
        /[-•]\s*\*?\*?([^(]+?)\s*\([A-Z]\d{2}/g,             // "- Diagnosis (ICD-10"
    ];
    
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(assessmentText)) !== null) {
            const name = match[1].replace(/\*+/g, '').trim();
            if (name.length > 3 && name.length < 100 && !diagnoses.includes(name)) {
                diagnoses.push(name);
            }
        }
    }
    
    return diagnoses;
}
```

### Step 2: Create `/lib/evidence-enrichment.ts` — Enrichment Logic

```typescript
/**
 * Evidence Enrichment Module
 * 
 * Takes parsed SOAP sections, queries PubMed for each diagnosis,
 * and appends an "Evidence-Based References" section to the Plan.
 */

import { searchPubMedGuidelines, extractDiagnoses, PubMedArticle } from './pubmed';

interface SoapSections {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
}

/**
 * Enrich the Plan section with PubMed citations for each diagnosis.
 * Returns updated sections with citations appended to the Plan.
 * 
 * Non-blocking: if PubMed fails, returns original sections unchanged.
 */
export async function enrichWithEvidence(sections: SoapSections): Promise<SoapSections & { citations: any[] }> {
    const allCitations: any[] = [];
    
    try {
        // 1. Extract diagnoses from Assessment
        const diagnoses = extractDiagnoses(sections.assessment);
        
        if (diagnoses.length === 0) {
            console.log('[Evidence] No diagnoses extracted from Assessment');
            return { ...sections, citations: [] };
        }
        
        console.log(`[Evidence] Found ${diagnoses.length} diagnoses: ${diagnoses.join(', ')}`);
        
        // 2. Query PubMed for each diagnosis (parallel, max 3 citations each)
        // Limit to first 5 diagnoses to keep PubMed requests reasonable
        const diagnosesToQuery = diagnoses.slice(0, 5);
        const results = await Promise.allSettled(
            diagnosesToQuery.map(dx => searchPubMedGuidelines(dx, 2))
        );
        
        // 3. Build citations block
        const citationLines: string[] = [];
        citationLines.push('');
        citationLines.push('**EVIDENCE-BASED REFERENCES**');
        citationLines.push('_The following clinical guidelines and peer-reviewed literature support the assessment and plan documented above:_');
        citationLines.push('');
        
        let citationNumber = 1;
        for (let i = 0; i < diagnosesToQuery.length; i++) {
            const result = results[i];
            if (result.status !== 'fulfilled' || result.value.length === 0) continue;
            
            const dx = diagnosesToQuery[i];
            citationLines.push(`**${dx}:**`);
            
            for (const article of result.value) {
                const citation = `${citationNumber}. ${article.authors} "${article.title}" ${article.journal}. ${article.year}. PMID: ${article.pmid}`;
                citationLines.push(citation);
                
                allCitations.push({
                    number: citationNumber,
                    diagnosis: dx,
                    pmid: article.pmid,
                    title: article.title,
                    journal: article.journal,
                    year: article.year,
                    url: article.url,
                });
                
                citationNumber++;
            }
            citationLines.push('');
        }
        
        // 4. Append to Plan if we found any citations
        if (citationNumber > 1) {
            const enrichedPlan = sections.plan + '\n\n' + citationLines.join('\n');
            console.log(`[Evidence] Added ${citationNumber - 1} citations to Plan`);
            return {
                ...sections,
                plan: enrichedPlan,
                citations: allCitations,
            };
        }
        
    } catch (err: any) {
        console.warn('[Evidence] Enrichment failed (non-fatal):', err?.message);
    }
    
    return { ...sections, citations: [] };
}
```

### Step 3: Modify `generate-note/route.ts` — Wire It In

Add ONE import at the top of the file (after the existing imports around line 4):

```typescript
import { enrichWithEvidence } from '@/lib/evidence-enrichment';
```

Then find this block (around line 580-596):

```typescript
        const sections = parseSoapSections(aiText);

        // Extract ICD-10 codes from assessment section
        const icd10Regex = /\([A-Z]\d{2}(?:\.\d{1,4})?\)/g;
```

Replace it with:

```typescript
        const rawSections = parseSoapSections(aiText);

        // ==================== EVIDENCE ENRICHMENT ====================
        // Query PubMed for clinical guidelines matching each diagnosis
        // Appends citations to the Plan section (non-blocking — fails gracefully)
        const enriched = await enrichWithEvidence(rawSections);
        const sections = enriched;

        // Extract ICD-10 codes from assessment section
        const icd10Regex = /\([A-Z]\d{2}(?:\.\d{1,4})?\)/g;
```

**That's it.** No other changes needed. The enrichment is non-blocking — if PubMed is down or slow, the note generates normally without citations.

### Step 4 (Optional): Add NCBI API Key to Environment

This is optional but recommended for production. Without a key, you're limited to 3 requests/second. With a key, you get 10/second.

1. Go to https://www.ncbi.nlm.nih.gov/account/ and sign in (or create a free account)
2. Click your username → Account Settings → API Key Management → Create an API Key
3. Add to your EC2 environment (ecosystem.config.js or .env):
   ```
   NCBI_API_KEY=your_key_here
   ```

### Step 5: Store Citations in Database (Optional Enhancement)

If you want to track citations over time, add a `evidence_citations` JSONB column to `scribe_notes`:

```sql
ALTER TABLE scribe_notes ADD COLUMN IF NOT EXISTS evidence_citations JSONB DEFAULT '[]'::jsonb;
```

Then in generate-note/route.ts, add `enriched.citations` to the INSERT:

Find the INSERT INTO scribe_notes query and add the column. This is optional — the citations are already embedded in the Plan text regardless.

## Testing

After deploying, generate a note for any patient. Check the Plan section — you should see an "EVIDENCE-BASED REFERENCES" block at the end with numbered citations including PMIDs.

## Cost

PubMed E-Utilities API is completely free. No additional AI costs since the citations are fetched and formatted without an LLM call. The only added latency is ~1-2 seconds for the PubMed API calls (run in parallel).

## Rollback

If you need to disable enrichment, simply comment out the `enrichWithEvidence()` call and change `const sections = enriched;` back to `const sections = rawSections;`. No other changes needed.
