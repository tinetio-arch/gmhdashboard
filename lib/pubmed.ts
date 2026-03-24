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

export interface PubMedArticle {
    pmid: string;
    title: string;
    authors: string;      // "Smith J, Doe A, et al."
    journal: string;      // "N Engl J Med"
    year: string;         // "2024"
    doi: string | null;
    url: string;          // "https://pubmed.ncbi.nlm.nih.gov/12345678/"
}

interface PatientDemographics {
    age?: number | null;
    gender?: string | null;
}

/**
 * Search PubMed for clinical practice guidelines related to a diagnosis.
 * Uses patient demographics to find more relevant results.
 * Returns top results sorted by relevance to this specific patient.
 */
export async function searchPubMedGuidelines(diagnosis: string, maxResults: number = 3, patient?: PatientDemographics): Promise<PubMedArticle[]> {
    // Build demographic-specific search terms using PubMed MeSH age filters
    // These are much more precise than free-text "adult" which still returns pediatric results
    let ageFilter = '';
    let excludeFilter = '';
    if (patient?.age) {
        if (patient.age >= 65) {
            ageFilter = '"Aged"[MeSH]';
            excludeFilter = 'NOT (child[MeSH] OR adolescent[MeSH] OR infant[MeSH] OR pediatric*)';
        } else if (patient.age >= 45) {
            ageFilter = '"Middle Aged"[MeSH]';
            excludeFilter = 'NOT (child[MeSH] OR adolescent[MeSH] OR infant[MeSH] OR pediatric*)';
        } else if (patient.age >= 18) {
            ageFilter = '"Adult"[MeSH]';
            excludeFilter = 'NOT (child[MeSH] OR adolescent[MeSH] OR infant[MeSH] OR pediatric*)';
        } else if (patient.age >= 13) {
            ageFilter = '"Adolescent"[MeSH]';
        } else {
            ageFilter = '"Child"[MeSH]';
        }
    } else {
        // Default: assume adult, exclude pediatric
        ageFilter = '"Adult"[MeSH]';
        excludeFilter = 'NOT (child[MeSH] OR adolescent[MeSH] OR infant[MeSH] OR pediatric*)';
    }

    const genderTerm = patient?.gender
        ? patient.gender.toLowerCase().startsWith('m') ? '"Male"[MeSH]'
          : patient.gender.toLowerCase().startsWith('f') ? '"Female"[MeSH]'
          : ''
        : '';

    // Build search query: diagnosis + demographics + guideline filter + exclude pediatric
    const demographicParts = [ageFilter, genderTerm].filter(Boolean).join(' AND ');
    const query = `${diagnosis} AND ${demographicParts} AND (Practice Guideline[PT] OR Guideline[PT] OR systematic review[PT] OR "clinical practice guideline"[TI]) ${excludeFilter}`;

    const apiKeyParam = API_KEY ? `&api_key=${API_KEY}` : '';

    // Step 1: ESearch — get PMIDs
    const searchUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&sort=relevance&retmode=json${apiKeyParam}`;

    const searchResp = await fetch(searchUrl);
    const searchData = await searchResp.json();
    const pmids: string[] = searchData?.esearchresult?.idlist || [];

    if (pmids.length === 0) {
        // Fallback: broader search with demographics but without guideline filter
        const broadQuery = `${diagnosis} AND ${demographicParts} AND (review[PT] OR meta-analysis[PT]) ${excludeFilter}`;
        const broadUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(broadQuery)}&retmax=${maxResults}&sort=relevance&retmode=json${apiKeyParam}`;
        const broadResp = await fetch(broadUrl);
        const broadData = await broadResp.json();
        const broadPmids: string[] = broadData?.esearchresult?.idlist || [];

        if (broadPmids.length === 0) {
            // Final fallback: just diagnosis + guideline + exclude pediatric
            const fallbackQuery = `${diagnosis} AND (Practice Guideline[PT] OR Guideline[PT] OR systematic review[PT]) ${excludeFilter}`;
            const fallbackUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(fallbackQuery)}&retmax=${maxResults}&sort=relevance&retmode=json${apiKeyParam}`;
            const fallbackResp = await fetch(fallbackUrl);
            const fallbackData = await fallbackResp.json();
            const fallbackPmids: string[] = fallbackData?.esearchresult?.idlist || [];
            if (fallbackPmids.length === 0) return [];
            pmids.push(...fallbackPmids);
        } else {
            pmids.push(...broadPmids);
        }
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
    // [^(\n]+? prevents matching across newlines
    const patterns = [
        /\d+\.\s*\*?\*?([^(\n]+?)\s*\([A-Z]\d{2}/g,          // "1. Diagnosis (ICD-10"
        /\*\*([^(\n]+?)\s*\([A-Z]\d{2}/g,                      // "**Diagnosis (ICD-10"
        /[-•]\s*\*?\*?([^(\n]+?)\s*\([A-Z]\d{2}/g,             // "- Diagnosis (ICD-10"
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
