/**
 * Evidence Enrichment Module
 *
 * Takes parsed SOAP sections, queries PubMed for each diagnosis,
 * and appends an "Evidence-Based References" section to the Plan.
 */

import { searchPubMedGuidelines, extractDiagnoses } from './pubmed';

interface SoapSections {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
}

interface PatientContext {
    age?: number | null;
    gender?: string | null;  // 'male' | 'female' | etc.
}

/**
 * Enrich the Plan section with PubMed citations for each diagnosis.
 * Returns updated sections with citations appended to the Plan.
 *
 * Non-blocking: if PubMed fails, returns original sections unchanged.
 */
export async function enrichWithEvidence(sections: SoapSections, patient?: PatientContext): Promise<SoapSections & { citations: any[] }> {
    const allCitations: any[] = [];

    try {
        // 1. Extract diagnoses from Assessment
        const diagnoses = extractDiagnoses(sections.assessment);

        if (diagnoses.length === 0) {
            console.log('[Evidence] No diagnoses extracted from Assessment');
            return { ...sections, citations: [] };
        }

        console.log(`[Evidence] Found ${diagnoses.length} diagnoses: ${diagnoses.join(', ')}`);

        // 2. Query PubMed for each diagnosis (sequential with small delay to avoid rate limits)
        // PubMed allows 3 req/sec without key, 10/sec with key — each search makes 2 requests
        // Limit to first 5 diagnoses to keep PubMed requests reasonable
        const diagnosesToQuery = diagnoses.slice(0, 5);
        const results: PromiseSettledResult<Awaited<ReturnType<typeof searchPubMedGuidelines>>>[] = [];
        for (let i = 0; i < diagnosesToQuery.length; i++) {
            // Small delay between queries to respect PubMed rate limits (3/sec without key, 10/sec with key)
            if (i > 0) await new Promise(r => setTimeout(r, 350));
            try {
                const articles = await searchPubMedGuidelines(diagnosesToQuery[i], 2, patient);
                results.push({ status: 'fulfilled', value: articles });
            } catch (err) {
                results.push({ status: 'rejected', reason: err });
            }
        }

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

        // 4. Return citations separately — do NOT append to Plan text
        // Citations are stored in evidence_citations JSONB and rendered separately on the frontend
        // This prevents AI edits from accidentally removing them
        if (citationNumber > 1) {
            console.log(`[Evidence] Found ${citationNumber - 1} citations for ${allCitations.map(c => c.diagnosis).filter((v,i,a) => a.indexOf(v) === i).join(', ')}`);
            return {
                ...sections,
                citations: allCitations,
                citationsText: citationLines.join('\n'),
            };
        }

    } catch (err: any) {
        console.warn('[Evidence] Enrichment failed (non-fatal):', err?.message);
    }

    return { ...sections, citations: [] };
}
