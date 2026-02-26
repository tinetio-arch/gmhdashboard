#!/usr/bin/env npx tsx
/**
 * LabGen Monitor - URL SCRAPING approach
 * Scrapes PDF URLs from page, downloads directly via HTTP
 */

import { chromium, Browser, Page } from 'playwright';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';

const LABGEN_URL = 'https://access.labsvc.net/labgen/';
const LABGEN_USERNAME = process.env.LABGEN_USERNAME || 'pschafer';
const LABGEN_PASSWORD = process.env.LABGEN_PASSWORD || 'xSqQaE1232';
const S3_BUCKET = process.env.S3_BUCKET || 'gmh-clinical-data-lake';
const LOG_FILE = '/home/ec2-user/gmhdashboard/data/document-intake.json';

class LabGenMonitor {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private s3Client: S3Client;
    private cookies: string = '';

    constructor() {
        this.s3Client = new S3Client({ region: 'us-east-2' });
        const logDir = path.dirname(LOG_FILE);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    async login(): Promise<void> {
        console.log('🔐 Logging into LabGen...');

        this.browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        this.page = await this.browser.newPage();

        await this.page.goto(LABGEN_URL);
        await this.page.waitForTimeout(5000);

        await this.page.fill('input[placeholder="User ID"]', LABGEN_USERNAME);
        await this.page.fill('input[placeholder="Password"]', LABGEN_PASSWORD);
        await this.page.click('.icon-login');

        await this.page.waitForSelector('text=Inbox', { timeout: 20000 });

        // Capture session cookies for direct HTTP requests
        const cookies = await this.page.context().cookies();
        this.cookies = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        console.log('   ✅ Logged in');
    }

    async scrapePDFUrls(): Promise<string[]> {
        if (!this.page) throw new Error('Not logged in');

        console.log('📋 Navigating to Inbox...');
        await this.page.click('text=Inbox');
        await this.page.waitForTimeout(5000);

        console.log('   🔍 Scraping page for PDF URLs...');

        // Get the page HTML and search for PDF links
        const pdfUrls = await this.page.evaluate(() => {
            const urls: string[] = [];

            // Look for all links on the page
            const links = document.querySelectorAll('a');

            links.forEach(link => {
                const href = link.getAttribute('href');
                // Look for webrep.cgi download links
                if (href && href.includes('webrep.cgi') && href.includes('repdown')) {
                    // Convert relative URL to absolute
                    const fullUrl = href.startsWith('http') ? href : `https://access.labsvc.net${href}`;
                    urls.push(fullUrl);
                }
            });

            // Also check onclick attributes that might trigger downloads
            const buttons = document.querySelectorAll('[onclick]');
            buttons.forEach(btn => {
                const onclick = btn.getAttribute('onclick') || '';
                const match = onclick.match(/webrep\.cgi\?[^'"]+/);
                if (match) {
                    urls.push(`https://access.labsvc.net/${match[0]}`);
                }
            });

            return [...new Set(urls)]; // Remove duplicates
        });

        console.log(`   Found ${pdfUrls.length} PDF URLs`);

        if (pdfUrls.length === 0) {
            // Fallback: Try to click "Print Selected reports" and capture the URL
            console.log('   🔄 Trying alternate method: capturing Print dialog URL...');

            try {
                // Select all checkboxes first
                await this.page.click('.x-grid3-hd-checker');
                await this.page.waitForTimeout(2000);

                // Wait for navigation when clicking Print
                const [response] = await Promise.all([
                    this.page.waitForResponse(response =>
                        response.url().includes('webrep.cgi'),
                        { timeout: 10000 }
                    ),
                    this.page.click('text=Print Selected reports')
                ]);

                const printUrl = response.url();
                console.log(`   ✅ Captured print URL: ${printUrl}`);
                return [printUrl];

            } catch (e) {
                console.log('   ⚠️  Could not capture print URL');
            }
        }

        return pdfUrls;
    }

    async downloadPDF(url: string): Promise<Buffer | null> {
        console.log(`   📥 Downloading: ${url}`);

        try {
            const response = await fetch(url, {
                headers: {
                    'Cookie': this.cookies,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!response.ok) {
                console.log(`   ❌ HTTP ${response.status}: ${response.statusText}`);
                return null;
            }

            const buffer = await response.buffer();
            console.log(`   ✅ Downloaded ${buffer.length} bytes`);
            return buffer;

        } catch (error) {
            console.error(`   ❌ Download error:`, error);
            return null;
        }
    }

    async uploadToS3(pdfBuffer: Buffer, index: number): Promise<string> {
        const today = new Date().toISOString().split('T')[0];
        const filename = `labs_${today}_${index}_${Date.now()}.pdf`;
        const s3Key = `incoming/labs/${today}/${filename}`;

        await this.s3Client.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: pdfBuffer,
            ContentType: 'application/pdf',
            Metadata: {
                source: 'labgen',
                downloadedAt: new Date().toISOString()
            }
        }));

        console.log(`   ✅ Uploaded to S3: ${s3Key}`);
        return s3Key;
    }

    async run(): Promise<void> {
        try {
            await this.login();
            const pdfUrls = await this.scrapePDFUrls();

            if (pdfUrls.length === 0) {
                console.log('\n⚠️  No PDF URLs found');
                return;
            }

            console.log(`\n📤 Processing ${pdfUrls.length} PDFs...\n`);

            let uploaded = 0;
            for (let i = 0; i < pdfUrls.length; i++) {
                const url = pdfUrls[i];
                console.log(`\n📄 PDF ${i + 1}/${pdfUrls.length}`);

                const pdfBuffer = await this.downloadPDF(url);

                if (pdfBuffer) {
                    const s3Path = await this.uploadToS3(pdfBuffer, i);

                    // Log to tracking file
                    const record = {
                        id: uuidv4(),
                        pdfUrl: url,
                        s3Path: `s3://${S3_BUCKET}/${s3Path}`,
                        downloadedAt: new Date().toISOString(),
                        type: 'lab',
                        processed: false,
                        fileSize: pdfBuffer.length
                    };

                    let logs: any[] = [];
                    if (fs.existsSync(LOG_FILE)) {
                        logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
                    }
                    logs.push(record);
                    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));

                    uploaded++;
                }
            }

            console.log(`\n✅ SUCCESS! Uploaded ${uploaded}/${pdfUrls.length} PDFs to S3`);

        } catch (error) {
            console.error('\n❌ Error:', error);
            throw error;
        } finally {
            if (this.browser) await this.browser.close();
        }
    }
}

if (require.main === module) {
    new LabGenMonitor().run().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export default LabGenMonitor;
