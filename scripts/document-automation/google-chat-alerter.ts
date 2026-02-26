#!/usr/bin/env npx tsx
/**
 * Google Chat Alerter
 * Sends tiered alerts based on severity level
 */

import * as fs from 'fs';

const LOG_FILE = '/home/ec2-user/gmhdashboard/data/document-intake.json';
const GOOGLE_CHAT_CRITICAL = process.env.GOOGLE_CHAT_CRITICAL_WEBHOOK;
const GOOGLE_CHAT_REVIEW = process.env.GOOGLE_CHAT_REVIEW_WEBHOOK;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

interface Alert {
    documentId: string;
    patientName: string;
    severity: number;
    findings: string[];
    criticalValues: any[];
    recommendation: string;
    type: 'lab' | 'imaging';
}

class GoogleChatAlerter {
    /**
     * Send alert to Google Chat
     */
    async sendToGoogleChat(webhook: string | undefined, card: any): Promise<void> {
        if (!webhook) {
            console.log('   ⚠️  Google Chat webhook not configured');
            return;
        }

        try {
            const response = await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(card)
            });

            if (response.ok) {
                console.log('   ✅ Sent to Google Chat');
            } else {
                console.error(`   ❌ Google Chat error: ${response.status}`);
            }
        } catch (error) {
            console.error(`   ❌ Google Chat error:`, error);
        }
    }

    /**
     * Send Level 5 alert to Telegram
     */
    async sendToTelegram(message: string): Promise<void> {
        if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
            console.log('   ⚠️  Telegram not configured');
            return;
        }

        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: message,
                    parse_mode: 'Markdown'
                })
            });

            if (response.ok) {
                console.log('   ✅ Sent to Telegram');
            } else {
                console.error(`   ❌ Telegram error: ${response.status}`);
            }
        } catch (error) {
            console.error(`   ❌ Telegram error:`, error);
        }
    }

    /**
     * Create Google Chat card
     */
    createCard(alert: Alert): any {
        const emoji = alert.severity >= 5 ? '🚨' : alert.severity >= 4 ? '⚠️' : '📊';
        const severityText = ['', 'Informational', 'Important', 'Significant', 'Urgent', 'CRITICAL'][alert.severity];

        return {
            cardsV2: [{
                card: {
                    header: {
                        title: `${emoji} ${severityText} - ${alert.type === 'lab' ? 'Lab Result' : 'Imaging Report'}`,
                        subtitle: alert.patientName
                    },
                    sections: [{
                        widgets: [
                            {
                                textParagraph: {
                                    text: `<b>Severity:</b> Level ${alert.severity} - ${severityText}<br><b>Type:</b> ${alert.type === 'lab' ? 'Laboratory' : 'Imaging'}`
                                }
                            },
                            {
                                textParagraph: {
                                    text: `<b>Key Findings:</b><br>${alert.findings.map(f => `• ${f}`).join('<br>')}`
                                }
                            },
                            ...(alert.criticalValues.length > 0 ? [{
                                textParagraph: {
                                    text: `<b>Critical Values:</b><br>${alert.criticalValues.map(v => `• ${v.name}: ${v.value} (normal: ${v.normal})`).join('<br>')}`
                                }
                            }] : []),
                            {
                                textParagraph: {
                                    text: `<b>Recommendation:</b> ${alert.recommendation}`
                                }
                            }
                        ]
                    }]
                }
            }]
        };
    }

    /**
     * Process alerts for analyzed documents
     */
    async processAlerts(): Promise<void> {
        if (!fs.existsSync(LOG_FILE)) {
            console.log('No documents to alert on');
            return;
        }

        const documents = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
        const analyzed = documents.filter((doc: any) => doc.analysis && !doc.alerted);

        console.log(`\n🔔 Processing ${analyzed.length} alerts...\n`);

        for (const doc of analyzed) {
            const analysis = doc.analysis;
            const alert: Alert = {
                documentId: doc.id,
                patientName: doc.patientName || doc.name || 'Unknown',
                severity: analysis.severity,
                findings: analysis.findings,
                criticalValues: analysis.criticalValues || [],
                recommendation: analysis.recommendation,
                type: doc.type === 'imaging' ? 'imaging' : 'lab'
            };

            console.log(`📢 Alert - ${alert.patientName} (Level ${alert.severity})`);

            // Level 5: Critical - Google Chat + Telegram
            if (alert.severity >= 5) {
                const card = this.createCard(alert);
                await this.sendToGoogleChat(GOOGLE_CHAT_CRITICAL, card);

                const telegramMsg = `🚨 *CRITICAL FINDING*\n\n*Patient:* ${alert.patientName}\n*Type:* ${alert.type}\n*Findings:* ${alert.findings[0]}\n\n*Action:* ${alert.recommendation}`;
                await this.sendToTelegram(telegramMsg);
            }
            // Level 4: Urgent - Google Chat Critical
            else if (alert.severity >= 4) {
                const card = this.createCard(alert);
                await this.sendToGoogleChat(GOOGLE_CHAT_CRITICAL, card);
            }
            // Level 3: Significant - Google Chat Review Queue
            else if (alert.severity >= 3) {
                const card = this.createCard(alert);
                await this.sendToGoogleChat(GOOGLE_CHAT_REVIEW, card);
            }
            // Level 1-2: Log only (no alert)
            else {
                console.log(`   ℹ️  Level ${alert.severity} - No alert sent (logged only)`);
            }

            // Mark as alerted
            doc.alerted = true;
            doc.alertedAt = new Date().toISOString();
        }

        // Save updated log
        fs.writeFileSync(LOG_FILE, JSON.stringify(documents, null, 2));
        console.log(`\n✅ Sent ${analyzed.length} alerts`);
    }
}

// Run if called directly
if (require.main === module) {
    const alerter = new GoogleChatAlerter();
    alerter.processAlerts().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export default GoogleChatAlerter;
