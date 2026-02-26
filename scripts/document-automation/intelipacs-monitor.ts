#!/usr/bin/env npx tsx
/**
 * InteliPACS Browser Automation - MVP Version
 * Monitors critical imaging findings and downloads reports
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

const INTELIPACS_URL = 'https://images.simonmed.com/Portal/app?logged_out=true#/';
const USERNAME = process.env.INTELIPACS_USERNAME || 'phil.schafer';
const PASSWORD = process.env.INTELIPACS_PASSWORD || 'Welcome123!';
const DOWNLOAD_DIR = '/home/ec2-user/gmhdashboard/data/imaging-reports';
const LOG_FILE = '/home/ec2-user/gmhdashboard/data/document-intake.json';

interface ImagingReport {
    id: string;
    patientName: string;
    studyDate: string;
    modality: string;
    priority: string;
    reportText: string;
    downloadedAt: string;
    processed: boolean;
}

class InteliPACSMonitor {
    private browser: Browser | null = null;
    private page: Page | null = null;

    constructor() {
        if (!fs.existsSync(DOWNLOAD_DIR)) {
            fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
        }
    }

    /**
     * Login to InteliPACS
     */
    async login(): Promise<void> {
        console.log('🔐 Logging into InteliPACS...');

        this.browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        this.page = await this.browser.newPage();

        await this.page.goto(INTELIPACS_URL);

        // Enter credentials
        await this.page.fill('#username', USERNAME);
        await this.page.fill('#password', PASSWORD);

        // Click sign-in
        await this.page.click('.icon-next');

        // Wait for confidentiality agreement
        await this.page.waitForSelector('text=Confidentiality Agreement', { timeout: 15000 });

        // Scroll and accept
        await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await this.page.click('text=Accept');

        // Wait for main portal
        await this.page.waitForSelector('text=Critical', { timeout: 15000 });

        console.log('   ✅ Logged in successfully');
    }

    /**
     * Get critical findings
     */
    async getCriticalFindings(): Promise<any[]> {
        if (!this.page) throw new Error('Not logged in');

        console.log('🔍 Checking Critical findings...');

        // Click Critical tab
        await this.page.click('text=Critical');
        await this.page.waitForTimeout(3000);

        // Extract findings (this is simplified - actual selectors may vary)
        const findings = await this.page.evaluate(() => {
            const results: any[] = [];
            // Look for order rows - adjust selectors based on actual DOM
            const rows = document.querySelectorAll('.order-row, .patient-row');

            rows.forEach(row => {
                const name = row.querySelector('.patient-name')?.textContent?.trim();
                const date = row.querySelector('.study-date')?.textContent?.trim();
                const modality = row.querySelector('.modality')?.textContent?.trim();
                const priority = row.querySelector('.priority')?.textContent?.trim();

                if (name) {
                    results.push({ name, date, modality, priority });
                }
            });

            return results;
        });

        console.log(`   Found ${findings.length} critical findings`);
        return findings;
    }

    /**
     * Get report text for a finding
     */
    async getReportText(finding: any): Promise<string> {
        if (!this.page) throw new Error('Not logged in');

        try {
            // Click on the finding to open report
            await this.page.click(`text=${finding.name}`);
            await this.page.waitForTimeout(2000);

            // Extract report text
            const reportText = await this.page.evaluate(() => {
                const reportEl = document.querySelector('.report-text, .report-content, pre');
                return reportEl?.textContent?.trim() || 'Report text not found';
            });

            console.log(`   ✅ Extracted report (${reportText.length} chars)`);
            return reportText;

        } catch (error) {
            console.error(`   ❌ Error getting report:`, error);
            return 'Error extracting report';
        }
    }

    /**
     * Log finding
     */
    logFinding(finding: any, reportText: string): void {
        const record: ImagingReport = {
            id: uuidv4(),
            patientName: finding.name,
            studyDate: finding.date || new Date().toISOString(),
            modality: finding.modality || 'Unknown',
            priority: finding.priority || 'Unknown',
            reportText: reportText,
            downloadedAt: new Date().toISOString(),
            processed: false
        };

        // Save report text to file
        const filename = `${record.id}.txt`;
        const filepath = path.join(DOWNLOAD_DIR, filename);
        fs.writeFileSync(filepath, reportText);

        // Update JSON log
        let logs: any[] = [];
        if (fs.existsSync(LOG_FILE)) {
            logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
        }

        logs.push({ ...record, type: 'imaging' });
        fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));

        console.log(`   ✅ Logged to ${LOG_FILE}`);
    }

    /**
     * Main run loop
     */
    async run(): Promise<void> {
        try {
            await this.login();
            const findings = await this.getCriticalFindings();

            let processed = 0;

            for (const finding of findings.slice(0, 5)) {  // Limit to 5 for testing
                console.log(`\n🏥 ${finding.name} - ${finding.modality}`);

                const reportText = await this.getReportText(finding);
                this.logFinding(finding, reportText);
                processed++;
            }

            console.log(`\n✅ Complete - Processed ${processed}/${findings.length} findings`);

        } catch (error) {
            console.error('\n❌ Error:', error);
            throw error;
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }
    }
}

// Run if called directly
if (require.main === module) {
    const monitor = new InteliPACSMonitor();
    monitor.run().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export default InteliPACSMonitor;
