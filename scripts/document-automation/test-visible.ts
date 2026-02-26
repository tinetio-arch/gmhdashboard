#!/usr/bin/env npx tsx
/**
 * Quick test - verbose logging
 */

import { chromium } from 'playwright';

(async () => {
    console.log('Starting...');
    const browser = await chromium.launch({
        headless: false,  // NOT headless so we can see what's happening
        args: ['--no-sandbox']
    });
    const page = await browser.newPage();

    console.log('Navigating to LabGen...');
    await page.goto('https://access.labsvc.net/labgen/');
    await page.waitForTimeout(3000);

    console.log('Logging in...');
    await page.fill('input[placeholder="User ID"]', 'pschafer');
    await page.fill('input[placeholder="Password"]', 'xSqQaE1232');
    await page.click('.icon-login');
    await page.waitForSelector('text=Inbox', { timeout: 15000 });

    console.log('Clicking Inbox...');
    await page.click('text=Inbox');
    await page.waitForTimeout(5000);  // More time

    console.log('Reading results...');
    const results = await page.evaluate(() => {
        const tables = document.querySelectorAll('.x-grid3-row-table');
        console.log('Found tables:', tables.length);

        const data = [];
        tables.forEach((table, idx) => {
            const cells = Array.from(table.querySelectorAll('td'));
            const text = cells.map(c => c.textContent?.trim());
            data.push({ idx, cells: text });
        });

        return data;
    });

    console.log('Results:', JSON.stringify(results.slice(0, 5), null, 2));
    console.log('Total:', results.length);

    // Keep browser open for 30 seconds
    await page.waitForTimeout(30000);
    await browser.close();
})().catch(console.error);
