#!/usr/bin/env npx tsx
/**
 * Test AWS S3 Access
 */

import { S3Client, ListBucketsCommand, PutObjectCommand } from '@aws-sdk/client-s3';

async function testS3() {
    console.log('🧪 Testing AWS S3 Access\n');

    const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });

    try {
        // Test 1: List buckets
        console.log('1. Listing buckets...');
        const buckets = await s3.send(new ListBucketsCommand({}));
        console.log(`   ✅ Found ${buckets.Buckets?.length || 0} buckets`);
        buckets.Buckets?.forEach(b => console.log(`      - ${b.Name}`));

        // Test 2: Upload test file
        const testBucket = process.env.S3_BUCKET || 'gmh-documents';
        console.log(`\n2. Uploading test file to ${testBucket}...`);

        await s3.send(new PutObjectCommand({
            Bucket: testBucket,
            Key: 'test/test-file.txt',
            Body: Buffer.from('Test file from document automation system'),
            ContentType: 'text/plain'
        }));

        console.log(`   ✅ Upload successful!`);
        console.log(`\n✅ AWS S3 access verified!`);

    } catch (error: any) {
        console.error(`\n❌ S3 Error: ${error.message}`);
        console.error('\nCheck:');
        console.error('- AWS_ACCESS_KEY_ID is set');
        console.error('- AWS_SECRET_ACCESS_KEY is set');
        console.error('- Bucket exists and permissions are correct');
        process.exit(1);
    }
}

testS3();
