/**
 * SQL Generation Module
 * 
 * Handles natural language to SQL conversion and answer formatting
 */

import type { ConversationContext } from './types';
import { callGemini } from './gemini';
import { SCHEMA_CONTEXT } from './conversation';

// ============================================================================
// SQL GENERATION
// ============================================================================
export async function generateSQL(
    question: string,
    prevContext?: ConversationContext | null
): Promise<string> {
    let prompt = SCHEMA_CONTEXT;

    // Add previous context for follow-up queries
    if (prevContext) {
        prompt += `\n\nPrevious query context:
- Previous question: "${prevContext.lastQuery}"
- Previous SQL: ${prevContext.lastSql}
- Previous results had ${prevContext.lastResults.length} rows

The user is asking a follow-up question. Use the context above to understand references to "they", "those", "these results", etc.
`;
    }

    prompt += `\n\nQuestion: "${question}"\n\nGenerate a Snowflake SQL query to answer this question. Return ONLY the SQL query, nothing else.`;

    console.log('[Bot] 🤖 Generating SQL for:', question);
    const response = await callGemini(prompt, 2000, 0);

    // Clean up the response
    let sql = response.trim();
    if (sql.startsWith('```sql')) {
        sql = sql.replace(/^```sql\s*/, '').replace(/\s*```$/, '');
    } else if (sql.startsWith('```')) {
        sql = sql.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    console.log('[Bot] 📝 Generated SQL:', sql.substring(0, 100) + '...');
    return sql;
}

// ============================================================================
// SELF-HEALING SQL
// ============================================================================
export async function generateFixedSQL(
    originalQuestion: string,
    failedSQL: string,
    errorMessage: string,
    prevContext?: ConversationContext | null
): Promise<string> {
    let fixPrompt = `${SCHEMA_CONTEXT}

The following SQL query failed:
\`\`\`sql
${failedSQL}
\`\`\`

Error message: ${errorMessage}

Original question: "${originalQuestion}"

Please generate a CORRECTED SQL query that fixes this error. Remember:
1. Use only columns that exist in the schema above
2. For QBO customer ID, use GMH_CLINIC.PATIENT_DATA.PATIENTS table, NOT PATIENT_360_VIEW
3. Use proper Snowflake syntax
4. Return ONLY the corrected SQL, no explanation.

Corrected SQL:`;

    if (prevContext) {
        fixPrompt = `Previous context:\n- Query: ${prevContext.lastQuery}\n- SQL: ${prevContext.lastSql}\n\n` + fixPrompt;
    }

    console.log('[Bot] 🔧 Generating fixed SQL...');
    const response = await callGemini(fixPrompt, 1500, 0);

    // Clean up the response
    let correctedSQL = response.trim();
    if (correctedSQL.startsWith('```sql')) {
        correctedSQL = correctedSQL.replace(/^```sql\s*/, '').replace(/\s*```$/, '');
    } else if (correctedSQL.startsWith('```')) {
        correctedSQL = correctedSQL.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    console.log('[Bot] 🔧 Generated fixed SQL:', correctedSQL.substring(0, 100) + '...');
    return correctedSQL;
}

// ============================================================================
// ANSWER FORMATTING
// ============================================================================
export async function formatAnswer(
    question: string,
    sql: string,
    results: any[],
    additionalContext: string = ''
): Promise<string> {
    if (results.length === 0) {
        return "No results found for your query.";
    }

    // For small result sets, format nicely
    if (results.length <= 10) {
        const formattedResults = JSON.stringify(results, null, 2);

        const prompt = `Given this question: "${question}"
    
And these SQL results:
${formattedResults}

${additionalContext}

Please provide a clear, concise summary of the results in a conversational tone. Format numbers nicely (currency, percentages, etc.). If there are multiple records, list the key information. Keep it under 300 words.`;

        return await callGemini(prompt, 800, 0.3);
    }

    // For larger result sets, summarize
    const sampleResults = results.slice(0, 5);
    const formattedSample = JSON.stringify(sampleResults, null, 2);

    const prompt = `Given this question: "${question}"

The query returned ${results.length} results. Here are the first 5:
${formattedSample}

${additionalContext}

Please provide a brief summary of what was found, mentioning the total count and key patterns. Keep it under 200 words.`;

    return await callGemini(prompt, 500, 0.3);
}

// Re-export schema context for use in other modules
export { SCHEMA_CONTEXT };
