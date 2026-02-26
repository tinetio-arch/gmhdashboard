#!/usr/bin/env npx tsx
/**
 * AI Document Analyzer - AWS Bedrock Version
 * Uses AWS Bedrock instead of direct Anthropic API
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import * as fs from 'fs';

const LOG_FILE = '/home/ec2-user/gmhdashboard/data/document-intake.json';

interface AnalysisResult {
    severity: number;
    findings: string[];
    criticalValues: Array<{ name: string, value: string, normal: string }>;
    recommendation: string;
    confidence: number;
}

const SEVERITY_PROMPT = `You are a clinical AI assistant analyzing medical reports. 

Analyze this report and provide:
1. Severity level (1-5):
   - Level 5: Immediately life-threatening (PE, ICH, K+ >6.5, acute MI, etc.) - requires <30 min response
   - Level 4: Urgent - needs attention within 3 hours
   - Level 3: Significant - same-day follow-up needed
   - Level 2: Important - 24-48 hour follow-up
   - Level 1: Informational - routine follow-up

2. Key findings (bullet points)
3. Critical abnormal values (if any)
4. Recommended action

Respond in JSON format:
{
  "severity": 1-5,
  "findings": ["finding 1", "finding 2"],
  "criticalValues": [{"name": "Potassium", "value": "6.8", "normal": "3.5-5.0"}],
  "recommendation": "action to take",
  "confidence": 0.0-1.0
}`;

class DocumentAnalyzer {
    private client: BedrockRuntimeClient;

    constructor() {
        this.client = new BedrockRuntimeClient({
            region: process.env.AWS_REGION || 'us-east-1'
        });
    }

    async analyze(documentText: string, type: 'lab' | 'imaging'): Promise<AnalysisResult> {
        console.log(`🤖 Analyzing ${type} report (${documentText.length} chars)...`);

        try {
            const payload = {
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: `${SEVERITY_PROMPT}\n\nReport Type: ${type}\n\nReport:\n${documentText.substring(0, 10000)}`
                }]
            };

            const command = new InvokeModelCommand({
                modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(payload)
            });

            const response = await this.client.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));

            const text = responseBody.content[0].text;
            const jsonMatch = text.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }

            const result: AnalysisResult = JSON.parse(jsonMatch[0]);
            console.log(`   ✅ Analysis complete - Severity Level ${result.severity}`);
            return result;

        } catch (error) {
            console.error(`   ❌ Analysis error:`, error);
            return {
                severity: 2,
                findings: ['Error analyzing document'],
                criticalValues: [],
                recommendation: 'Manual review recommended',
                confidence: 0.0
            };
        }
    }

    async processQueue(): Promise<void> {
        if (!fs.existsSync(LOG_FILE)) {
            console.log('No documents to process');
            return;
        }

        const documents = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
        const pending = documents.filter((doc: any) => !doc.processed);

        console.log(`\n📊 Processing ${pending.length} pending documents...\n`);

        for (const doc of pending) {
            console.log(`📄 ${doc.patientName || doc.name || 'Unknown'}`);

            let documentText = '';

            if (doc.pdfPath && doc.pdfPath.includes('s3://')) {
                // For now, use metadata - in production, download from S3 and parse PDF
                documentText = `Lab result for ${doc.patientName}, Acc# ${doc.accessionNumber}`;
            } else if (doc.reportText) {
                documentText = doc.reportText;
            }

            if (!documentText) {
                console.log('   ⚠️  No text to analyze, skipping');
                continue;
            }

            const analysis = await this.analyze(
                documentText,
                doc.type === 'imaging' ? 'imaging' : 'lab'
            );

            doc.analysis = analysis;
            doc.processed = true;
            doc.analyzedAt = new Date().toISOString();

            console.log(`   Severity: Level ${analysis.severity}`);
            console.log(`   Findings: ${analysis.findings.slice(0, 2).join(', ')}`);
            console.log('');
        }

        fs.writeFileSync(LOG_FILE, JSON.stringify(documents, null, 2));
        console.log(`✅ Processed ${pending.length} documents`);
    }
}

if (require.main === module) {
    const analyzer = new DocumentAnalyzer();
    analyzer.processQueue().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export default DocumentAnalyzer;
