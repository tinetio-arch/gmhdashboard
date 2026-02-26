#!/usr/bin/env tsx
/**
 * Deep Search Healthie Users (Fixed)
 * 
 * Searches the Healthie API directly for ANY user matching an email
 * by listing users page by page.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/.env' });
dotenv.config({ path: '.env.local' });

import { HealthieClient } from '../lib/healthie';

async function main() {
    const emailRegex = process.argv[2] || 'philschafer7@gmail.com';
    console.log(`\n🔍 Deep searching Healthie API for users matching: ${emailRegex}\n`);

    const healthie = new HealthieClient({
        apiKey: process.env.HEALTHIE_API_KEY!,
        apiUrl: process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql'
    });

    try {
        const query = `
      query ListUsers($offset: Int) {
        users(offset: $offset) {
          id
          first_name
          last_name
          email
          active
          last_sign_in_at
          created_at
        }
      }
    `;

        let offset = 0;
        let found = 0;
        const MAX_PAGES = 20; // Check 20 pages (approx 1000 users?? depending on page size)

        // Healthie page size is usually 25 or 50.

        console.log('Fetching users...');

        for (let i = 0; i < MAX_PAGES; i++) {
            const result = await healthie.graphql<{ users: any[] }>(query, { offset });
            const users = result.users || [];

            if (users.length === 0) break;

            for (const u of users) {
                if (u.email && u.email.toLowerCase().includes(emailRegex.toLowerCase())) {
                    console.log(`\n🎯 FOUND MATCH:`);
                    console.log(`   ID: ${u.id}`);
                    console.log(`   Name: ${u.first_name} ${u.last_name}`);
                    console.log(`   Email: ${u.email}`);
                    console.log(`   Active: ${u.active}`);
                    console.log(`   Last Sign In: ${u.last_sign_in_at}`);
                    console.log(`   Created: ${u.created_at}`);
                    found++;
                }
            }

            offset += users.length;
            process.stdout.write(`.`);
            if (users.length < 10) break; // End of list if page is small
        }
        console.log(`\n\nSearch complete. Found ${found} matches.`);

    } catch (err) {
        console.error('\nError searching Healthie:', err);
    }
}

main().catch(console.error);
