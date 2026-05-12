/**
 * Gender backfill: infer gender from first name for 131 patients with null gender
 * in Healthie. Updates BOTH Healthie (updateUser) AND local patients table.
 *
 * Strategy:
 * - Deterministic name→gender for common names (high confidence)
 * - Flag ambiguous names for manual review
 * - Never overwrite existing gender
 *
 * Run: cd ~/gmhdashboard && npx tsx .tmp/backfill-gender.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { query } from '../lib/db';
import { healthieGraphQL } from '../lib/healthieApi';

// Common first names → gender (US census-based, high confidence only)
const MALE_NAMES = new Set([
    'aaron','adam','adrian','alan','albert','alex','alexander','allen','andrew','anthony',
    'austin','barry','ben','benjamin','billy','blake','bob','brad','bradley','brandon',
    'brantley','brett','brian','bruce','bryan','caleb','carl','carlos','chad','charles',
    'chris','christopher','cody','cole','colin','cris','craig','dale','dan','daniel',
    'danny','darrell','darren','dave','david','dean','dennis','derek','devin','don',
    'donald','doug','douglas','drew','dustin','dylan','ed','edward','eric','erik',
    'ethan','evan','frank','fred','gary','george','glen','glenn','greg','gregory',
    'harold','harry','henry','howard','hunter','ian','jack','jackson','jacob','jake',
    'james','jared','jaren','jason','jay','jeff','jeffrey','jeremy','jerry','jesse',
    'jesus','jim','jimmy','joe','joel','john','jon','jonathan','jordan','joseph',
    'josh','joshua','juan','justin','karl','keaton','keith','ken','kenneth','kevin',
    'kurt','kyle','lance','landon','larry','lee','leo','leon','logan','louis',
    'lucas','luke','mark','martin','matt','matthew','max','michael','mike','milfred',
    'mitchell','nathan','neil','nick','noah','oliver','oscar','patrick','paul','peter',
    'phil','phillip','randy','ray','raymond','rich','richard','rick','rob','robert',
    'roger','ron','ronald','ross','roy','russell','ryan','sam','samuel','scott',
    'sean','seth','shane','shawn','stan','stanley','stephen','steve','steven','stuart',
    'ted','thomas','tim','timothy','todd','tom','tommy','tony','travis','troy',
    'tyler','ty','van','vince','vincent','von','wade','warren','wayne','william',
    'zach','zachary',
]);

const FEMALE_NAMES = new Set([
    'alana','alex','alexandra','alice','alicia','amanda','amber','amy','andrea','angela',
    'ann','anna','anne','annette','ashley','barbara','beth','betty','beverly','bonnie',
    'brandi','brandy','brenda','bridget','brittany','carol','caroline','catherine','cathy',
    'charlene','charlotte','cheryl','christie','christina','christine','cindy','claire',
    'colleen','connie','crystal','cynthia','dana','danielle','dawn','debbie','deborah',
    'denise','diana','diane','donna','dorothy','eileen','elaine','elizabeth','ellen',
    'emily','emma','erica','erin','eva','evelyn','faith','faye','felicia','gail',
    'gloria','grace','hannah','heather','heidi','helen','holly','irene','jackie',
    'jane','janet','janice','jean','jennifer','jenny','jessica','jill','joan','joanne',
    'jodi','joyce','judith','judy','julia','julie','june','karen','kate','katherine',
    'kathleen','kathryn','kathy','katie','kayla','keira','kelley','kelly','kendra',
    'kim','kimberly','kristen','kristin','kristina','laura','lauren','leah','linda',
    'lisa','lori','lorraine','louise','lynn','margaret','maria','marie','marilyn',
    'marla','martha','mary','maureen','megan','melanie','melissa','melody','mercedes',
    'michele','michelle','millie','miriam','molly','monica','nancy','natalie','nicole',
    'nina','norma','olivia','pam','pamela','patricia','paula','peggy','penny','phyllis',
    'rachelle','rebecca','reina','renee','rhonda','rita','roberta','robin','rosa','rose',
    'ruth','sally','samantha','sandra','sara','sarah','shannon','sharon','sheila',
    'shelley','sherry','shirley','sophia','stacy','stella','stephanie','sue','susan',
    'suzanne','sylvia','tammy','tanya','teresa','terri','terry','theresa','tiffany',
    'tina','tracy','valerie','vanessa','veronica','vicki','victoria','virginia','vivian',
    'wendy','zoe',
]);

interface PatientRow {
    patient_id: string;
    full_name: string;
    healthie_client_id: string;
    gender: string | null;
}

function inferGender(fullName: string): { gender: 'Male' | 'Female' | null; confidence: 'high' | 'ambiguous' } {
    const firstName = (fullName || '').trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
    if (!firstName) return { gender: null, confidence: 'ambiguous' };
    if (MALE_NAMES.has(firstName)) return { gender: 'Male', confidence: 'high' };
    if (FEMALE_NAMES.has(firstName)) return { gender: 'Female', confidence: 'high' };
    return { gender: null, confidence: 'ambiguous' };
}

async function main() {
    // Get all patients with null gender in local DB
    const patients = await query<PatientRow>(`
        SELECT patient_id::text, full_name, healthie_client_id, gender
        FROM patients
        WHERE (gender IS NULL OR gender = '')
          AND healthie_client_id IS NOT NULL
        ORDER BY full_name
    `);
    console.log(`[gender-backfill] ${patients.length} patients with null gender\n`);

    let updated = 0, skipped = 0, ambiguous = 0, errors = 0;
    const ambiguousNames: string[] = [];

    for (const p of patients) {
        const { gender, confidence } = inferGender(p.full_name);

        if (!gender || confidence === 'ambiguous') {
            ambiguous++;
            ambiguousNames.push(`${p.full_name} (${p.healthie_client_id})`);
            continue;
        }

        // Update Healthie
        try {
            await healthieGraphQL<any>(
                `mutation($input: updateUserInput!) { updateUser(input: $input) { user { id gender } } }`,
                { input: { id: p.healthie_client_id, gender } }
            );
        } catch (e: any) {
            console.error(`  ✗ ${p.full_name}: Healthie error: ${e.message.slice(0, 80)}`);
            errors++;
            continue;
        }

        // Update local
        await query(`UPDATE patients SET gender = $1, updated_at = NOW() WHERE patient_id = $2`, [gender, p.patient_id]);
        updated++;
        process.stdout.write('.');
    }

    console.log(`\n\n=== RESULTS ===`);
    console.log(`Updated (Healthie + local): ${updated}`);
    console.log(`Ambiguous (need manual review): ${ambiguous}`);
    console.log(`Errors: ${errors}`);
    console.log(`Skipped (already has gender): ${skipped}`);

    if (ambiguousNames.length) {
        console.log(`\nAmbiguous names (${ambiguousNames.length}):`);
        for (const n of ambiguousNames) console.log(`  ${n}`);
    }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
