#!/usr/bin/env npx tsx
/**
 * Document Automation Orchestrator
 * Runs all components in sequence: monitor → analyze → alert
 */

import LabGenMonitor from './labgen-monitor';
import InteliPACSMonitor from './intelipacs-monitor';
import DocumentAnalyzer from './ai-analyzer';
import GoogleChatAlerter from './google-chat-alerter';

async function main() {
    console.log('🚀 Document Automation System - Full Run\n');
    console.log('='.repeat(60));

    try {
        // Step 1: Download new documents
        console.log('\n📥 STEP 1: Downloading Documents');
        console.log('─'.repeat(60));

        const labMonitor = new LabGenMonitor();
        await labMonitor.run();

        console.log('\n');
        const imagingMonitor = new InteliPACSMonitor();
        await imagingMonitor.run();

        // Step 2: Analyze with AI
        console.log('\n');
        console.log('🤖 STEP 2: AI Analysis');
        console.log('─'.repeat(60));

        const analyzer = new DocumentAnalyzer();
        await analyzer.processQueue();

        // Step 3: Send alerts
        console.log('\n');
        console.log('🔔 STEP 3: Sending Alerts');
        console.log('─'.repeat(60));

        const alerter = new GoogleChatAlerter();
        await alerter.processAlerts();

        // Summary
        console.log('\n');
        console.log('='.repeat(60));
        console.log('✅ Full automation cycle complete!');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('\n❌ Error:', error);
        process.exit(1);
    }
}

main();
