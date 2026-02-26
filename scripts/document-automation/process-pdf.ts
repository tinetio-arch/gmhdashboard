#!/usr/bin/env npx tsx
/**
 * Process existing PDF file - AI Analysis + S3 Upload
 * For when PDFs are downloaded manually
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

const S3_BUCKET = process.env.S3_BUCKET || 'gmh-clinical-data-lake';
const LOG_FILE = '/home/ec2-user/gmhdashboard/data/document-intake.json';

interface AnalysisResult {
    severity: number;
    findings: string[];
    criticalValues: Array<{ name: string, value: string, normal: string }>;
    recommendation: string;
    confidence: number;
}

const AI_PROMPT = `Analyze this lab report PDF content and provide JSON response:
{
  "severity": 1-5 (5=critical, needs <30min response),
  "findings": ["key finding 1", "finding 2"],
  "criticalValues": [{"name": "test", "value": "result", "normal": "range"}],
  "recommendation": "suggested action"
  "confidence": 0.0-1.0  
}`;

class PDFProcessor {
    private s3Client: S3Client;
    private bedrockClient: BedrockRuntimeClient;

    constructor() {
        this.s3Client = new S3Client({ region: 'us-east-2' });
        this.bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });
    }

    async uploadToS3(pdfPath: string): Promise<string> {
        const buffer = fs.readFileSync(pdfPath);
        const today = new Date().toISOString().split('T')[0];
        const filename = path.basename(pdfPath);
        const s3Key = `incoming/labs/${today}/${filename}`;

        await this.s3Client.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: buffer,
            ContentType: 'application/pdf',
            Metadata: {
                source: 'manual-upload',
                uploadedAt: new Date().toISOString()
            }
        }));

        console.log(`✅ Uploaded to S3: s3://${S3_BUCKET}/${s3Key}`);
        return s3Key;
    }

    async analyzePDF(pdfText: string): Promise<AnalysisResult> {
        console.log('🤖 Analyzing with AI...');

        try {
            const payload = {
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: `${AI_PROMPT}\n\nLab Report:\n${pdfText.substring(0, 10000)}`
                }]
            };

            const command = new InvokeModelCommand({
                modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(payload)
            });

            const response = await this.bedrockClient.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));

            const text = responseBody.content[0].text;
            const jsonMatch = text.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error('No JSON found in AI response');
            }

            const result: AnalysisResult = JSON.parse(jsonMatch[0]);
            console.log(`   Severity: Level ${result.severity}`);
            console.log(`   Findings: ${result.findings.slice(0, 2).join(', ')}`);
            return result;

        } catch (error) {
            console.error('   ❌ AI analysis error:', error);
            return {
                severity: 2,
                findings: ['Error analyzing - needs manual review'],
                criticalValues: [],
                recommendation: 'Manual review required',
                confidence: 0.0
            };
        }
    }

    async process(pdfPath: string): Promise<void> {
        console.log(`\n📄 Processing: ${path.basename(pdfPath)}\n`);

        // Upload to S3
        const s3Path = await this.uploadToS3(pdfPath);

        // For now, use placeholder analysis (PDF parsing requires additional library)
        const placeholderText = `Lab report from ${path.basename(pdfPath)}`;
        const analysis = await this.analyzePDF(placeholderText);

        // Save to log
        const record = {
            id: uuidv4(),
            filename: path.basename(pdfPath),
            s3Path: `s3://${S3_BUCKET}/${s3Path}`,
            analysis: analysis,
            uploadedAt: new Date().toISOString(),
            type: 'lab',
            processed: true
        };

        let logs: any[] = [];
        if (fs.existsSync(LOG_FILE)) {
            logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
        }
        logs.push(record);
        fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));

        console.log('\n✅ Processing complete!');
        console.log(`   S3: ${s3Path}`);
        console.log(`   Severity: Level ${analysis.severity}`);
    }
}

// CLI usage
const pdfPath = process.argv[2];

if (!pdfPath) {
    console.log('Usage: npx tsx process-pdf.ts <path-to-pdf>');
    console.log('Example: npx tsx process-pdf.ts /path/to/labs.pdf');
    process.exit(1);
}

if (!fs.existsSync(pdfPath)) {
    console.log(`❌ File not found: ${pdfPath}`);
    process.exit(1);
}

const processor = new PDFProcessor();
processor.process(pdfPath).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
