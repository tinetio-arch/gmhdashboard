#!/usr/bin/env node
/**
 * GHL Appointment Export Script
 * Exports all future appointments from GoHighLevel for migration to Healthie
 * 
 * Usage: node scripts/ghl-migration/export-ghl-appointments.js
 */

require('dotenv').config({ path: '/home/ec2-user/.env.production' });

const fs = require('fs');
const path = require('path');

class GHLAppointmentExporter {
    constructor() {
        this.mensHealthApiKey = process.env.GHL_MENS_HEALTH_API_KEY || process.env.GHL_API_KEY;
        this.primaryCareApiKey = process.env.GHL_PRIMARY_CARE_API_KEY || process.env.GHL_V2_API_KEY;

        this.mensHealthLocationId = process.env.GHL_MENS_HEALTH_LOCATION_ID || '0dpAFAovcFXbe0G5TUFr';
        this.primaryCareLocationId = process.env.GHL_PRIMARY_CARE_LOCATION_ID || 'NyfcCiwUMdmXafnUMML8';

        this.apiBase = 'https://services.leadconnectorhq.com';
        this.appointments = [];
    }

    async request(apiKey, method, endpoint) {
        const url = `${this.apiBase}${endpoint}`;

        const response = await fetch(url, {
            method,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Version': '2021-07-28'
            }
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`GHL API Error (${response.status}): ${error}`);
        }

        const text = await response.text();
        if (!text) return { success: true };
        return JSON.parse(text);
    }

    async getCalendars(apiKey, locationId, locationName) {
        console.log(`\n📅 Fetching calendars for ${locationName}...`);
        try {
            const result = await this.request(apiKey, 'GET', `/calendars/?locationId=${locationId}`);
            const calendars = result.calendars || [];
            console.log(`   Found ${calendars.length} calendars`);
            return calendars;
        } catch (error) {
            console.error(`   ❌ Error fetching calendars: ${error.message}`);
            return [];
        }
    }

    async getAppointments(apiKey, calendarId, locationId, startDate, endDate) {
        try {
            // GHL V2 API uses /calendars/events with timestamps in milliseconds
            const startTime = new Date(startDate).getTime();
            const endTime = new Date(endDate).getTime();
            const result = await this.request(apiKey, 'GET',
                `/calendars/events?calendarId=${calendarId}&locationId=${locationId}&startTime=${startTime}&endTime=${endTime}`
            );
            return result.events || [];
        } catch (error) {
            console.error(`   ❌ Error fetching appointments: ${error.message}`);
            return [];
        }
    }

    async getContactDetails(apiKey, contactId) {
        try {
            const result = await this.request(apiKey, 'GET', `/contacts/${contactId}`);
            return result.contact || result;
        } catch (error) {
            console.error(`   ⚠️ Could not fetch contact ${contactId}: ${error.message}`);
            return null;
        }
    }

    async exportLocation(apiKey, locationId, locationName) {
        console.log(`\n🏥 Exporting from: ${locationName}`);
        console.log('─'.repeat(50));

        const calendars = await this.getCalendars(apiKey, locationId, locationName);

        // Get appointments for the next 90 days
        const today = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 90);

        const startDateStr = today.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        let totalAppointments = 0;

        for (const calendar of calendars) {
            console.log(`\n   📆 Calendar: ${calendar.name || 'Unnamed'} (ID: ${calendar.id})`);

            const appointments = await this.getAppointments(
                apiKey,
                calendar.id,
                locationId,
                startDateStr,
                endDateStr
            );

            console.log(`      Found ${appointments.length} upcoming appointments`);
            totalAppointments += appointments.length;

            for (const appt of appointments) {
                // Enrich with contact details
                let contactInfo = null;
                if (appt.contactId) {
                    contactInfo = await this.getContactDetails(apiKey, appt.contactId);
                    // Add delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                this.appointments.push({
                    ghl_appointment_id: appt.id,
                    location: locationName,
                    location_id: locationId,
                    calendar_name: calendar.name,
                    calendar_id: calendar.id,
                    appointment_type: appt.appointmentType || appt.title || 'Unknown',
                    start_time: appt.startTime,
                    end_time: appt.endTime,
                    status: appt.status || 'confirmed',
                    contact_id: appt.contactId,
                    patient_name: contactInfo
                        ? `${contactInfo.firstName || ''} ${contactInfo.lastName || ''}`.trim()
                        : appt.title || 'Unknown',
                    patient_email: contactInfo?.email || null,
                    patient_phone: contactInfo?.phone || null,
                    notes: appt.notes || null,
                    created_at: appt.createdAt,
                    raw_data: appt
                });
            }
        }

        console.log(`\n   ✅ Total from ${locationName}: ${totalAppointments} appointments`);
        return totalAppointments;
    }

    async export() {
        console.log('═'.repeat(60));
        console.log('  GHL APPOINTMENT EXPORT FOR MIGRATION TO HEALTHIE');
        console.log('  Date:', new Date().toLocaleString());
        console.log('═'.repeat(60));

        let totalCount = 0;

        // Export from Men's Health location
        if (this.mensHealthApiKey) {
            totalCount += await this.exportLocation(
                this.mensHealthApiKey,
                this.mensHealthLocationId,
                "NOW Men's Health"
            );
        } else {
            console.log('\n⚠️ Men\'s Health API key not configured');
        }

        // Export from Primary Care location  
        if (this.primaryCareApiKey) {
            totalCount += await this.exportLocation(
                this.primaryCareApiKey,
                this.primaryCareLocationId,
                "NOW Primary Care"
            );
        } else {
            console.log('\n⚠️ Primary Care API key not configured');
        }

        // Write results to files
        const outputDir = path.join(__dirname, 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().split('T')[0];

        // Full JSON export
        const jsonPath = path.join(outputDir, `ghl-appointments-${timestamp}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(this.appointments, null, 2));

        // CSV for easy review
        const csvPath = path.join(outputDir, `ghl-appointments-${timestamp}.csv`);
        const csvHeader = 'Location,Calendar,Patient Name,Email,Phone,Appointment Type,Start Time,Status,GHL ID\n';
        const csvRows = this.appointments.map(a =>
            `"${a.location}","${a.calendar_name}","${a.patient_name}","${a.patient_email || ''}","${a.patient_phone || ''}","${a.appointment_type}","${a.start_time}","${a.status}","${a.ghl_appointment_id}"`
        ).join('\n');
        fs.writeFileSync(csvPath, csvHeader + csvRows);

        // Summary MD report
        const mdPath = path.join(outputDir, `ghl-appointments-summary-${timestamp}.md`);
        const mdContent = this.generateMarkdownReport();
        fs.writeFileSync(mdPath, mdContent);

        console.log('\n' + '═'.repeat(60));
        console.log('  EXPORT COMPLETE');
        console.log('═'.repeat(60));
        console.log(`\n📊 Total Appointments Found: ${totalCount}`);
        console.log(`\n📁 Output Files:`);
        console.log(`   • JSON: ${jsonPath}`);
        console.log(`   • CSV:  ${csvPath}`);
        console.log(`   • Summary: ${mdPath}`);
        console.log('');

        return this.appointments;
    }

    generateMarkdownReport() {
        const byLocation = {};
        const byDate = {};

        for (const appt of this.appointments) {
            // Group by location
            if (!byLocation[appt.location]) {
                byLocation[appt.location] = [];
            }
            byLocation[appt.location].push(appt);

            // Group by date
            const date = appt.start_time?.split('T')[0] || 'Unknown';
            if (!byDate[date]) {
                byDate[date] = [];
            }
            byDate[date].push(appt);
        }

        let md = `# GHL Appointments - Migration Export\n\n`;
        md += `**Export Date**: ${new Date().toLocaleString()}\n`;
        md += `**Total Appointments**: ${this.appointments.length}\n\n`;
        md += `---\n\n`;

        md += `## Summary by Location\n\n`;
        for (const [location, appts] of Object.entries(byLocation)) {
            md += `### ${location} (${appts.length} appointments)\n\n`;
            md += `| Patient | Appointment Type | Date/Time | Status |\n`;
            md += `|---------|-----------------|-----------|--------|\n`;
            for (const a of appts.slice(0, 50)) { // Limit to first 50 per location
                const dateTime = a.start_time ? new Date(a.start_time).toLocaleString() : 'TBD';
                md += `| ${a.patient_name} | ${a.appointment_type} | ${dateTime} | ${a.status} |\n`;
            }
            if (appts.length > 50) {
                md += `\n*...and ${appts.length - 50} more*\n`;
            }
            md += `\n`;
        }

        md += `## Appointments by Date\n\n`;
        const sortedDates = Object.keys(byDate).sort();
        for (const date of sortedDates.slice(0, 14)) { // First 2 weeks
            md += `### ${date} (${byDate[date].length} appointments)\n\n`;
            for (const a of byDate[date]) {
                const time = a.start_time ? new Date(a.start_time).toLocaleTimeString() : 'TBD';
                md += `- **${time}** - ${a.patient_name} (${a.appointment_type}) @ ${a.location}\n`;
            }
            md += `\n`;
        }

        md += `---\n\n`;
        md += `## Next Steps for Migration\n\n`;
        md += `1. Review appointments above for accuracy\n`;
        md += `2. Match patients to existing Healthie records (by email/phone)\n`;
        md += `3. Create Healthie appointments for each\n`;
        md += `4. Cancel or mark as "Migrated" in GHL\n`;
        md += `5. Disable GHL calendar booking\n\n`;

        return md;
    }
}

// Run the export
const exporter = new GHLAppointmentExporter();
exporter.export().catch(console.error);
