#!/usr/bin/env npx tsx
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const s3 = new S3Client({ region: 'us-east-2' });

// Find most recent PDF
const downloadDir = path.join(process.env.HOME || '/home/ec2-user', 'Downloads');
const files = fs.readdirSync(downloadDir)
    .filter(f => f.endsWith('.pdf'))
    .map(f => ({
        name: f,
        path: path.join(downloadDir, f),
        mtime: fs.statSync(path.join(downloadDir, f)).mtime
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

if (files.length === 0) {
    console.log('❌ No PDFs found in Downloads');
    process.exit(1);
}

const latestPDF = files[0];
console.log(`📄 Found: ${latestPDF.name}`);

const buffer = fs.readFileSync(latestPDF.path);
const today = new Date().toISOString().split('T')[0];
const s3Key = `incoming/labs/${today}/all_labs_${Date.now()}.pdf`;

await s3.send(new PutObjectCommand({
    Bucket: 'gmh-clinical-data-lake',
    Key: s3Key,
    Body: buffer,
    ContentType: 'application/pdf',
    Metadata: {
        source: 'labgen',
        pages: '17',
        downloadedAt: new Date().toISOString()
    }
}));

console.log(`✅ Uploaded to S3: s3://gmh-clinical-data-lake/${s3Key}`);
console.log(`📄 File size: ${buffer.length} bytes`);
