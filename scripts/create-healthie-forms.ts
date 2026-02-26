#!/usr/bin/env npx tsx
/**
 * Healthie Form Creator - Automated Form Generation
 * 
 * Creates all 5 Granite Mountain Health patient workflow forms via Healthie GraphQL API
 * 
 * Usage:
 *   export HEALTHIE_API_KEY="your-key"
 *   npx tsx create-healthie-forms.ts
 */

import fetch from 'node-fetch';

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';

interface FormQuestion {
    label: string;
    mod_type: string; // text, textarea, number, checkbox, radio, signature, date, file, phone
    required: boolean;
    options?: string[]; // for radio/checkbox types
    description?: string;
}

interface FormDefinition {
    name: string;
    description?: string;
    questions: FormQuestion[];
}

// ===== FORM DEFINITIONS =====

const forms: FormDefinition[] = [
    // Form 0: Men's Health Intake (Comprehensive)
    {
        name: "Men's Health Intake Form",
        description: "Comprehensive intake for Men's Health / TRT patients",
        questions: [
            { label: "Chief Complaint", mod_type: "textarea", required: true, description: "What are your main symptoms? (e.g. Low energy, libido, brain fog)" },
            { label: "Duration of Symptoms", mod_type: "text", required: true },
            { label: "History of Prostate Issues?", mod_type: "radio", required: true, options: ["Yes", "No", "Unknown"] },
            { label: "Family History of Prostate Cancer?", mod_type: "radio", required: true, options: ["Yes", "No"] },
            { label: "Cardiovascular History", mod_type: "textarea", required: true, description: "Any history of heart attack, stroke, or clotting disorders?" },
            { label: "Sleep Apnea Status", mod_type: "radio", required: true, options: ["Diagnosed & Treated", "Diagnosed & Untreated", "Suspected", "None"] },
            { label: "Desire for Fertility?", mod_type: "radio", required: true, options: ["Yes (Want kids now/later)", "No (Done with kids)", "Unsure"] },
            { label: "Current Exercise Routine", mod_type: "textarea", required: false },
            { label: "Patient Signature", mod_type: "signature", required: true },
        ]
    },

    // Form 00: General Hormone Optimization Consent (Injections & Pellets)
    {
        name: "Hormone Optimization Informed Consent",
        description: "General consent for Testosterone/Hormone therapy",
        questions: [
            { label: "Understanding of Risks", mod_type: "checkbox", required: true, description: "I understand risks including polycythemia (thick blood), prostate effects, and potential fertility reduction." },
            { label: "Commitment to Monitoring", mod_type: "checkbox", required: true, description: "I agree to strict adherence to lab work schedule as ordered by provider." },
            { label: "Controlled Substance Agreement", mod_type: "checkbox", required: true, description: "I understand testosterone is a controlled substance and will not share or sell medication." },
            { label: "Therapy Expectations", mod_type: "checkbox", required: true, description: "I understand symptom relief may take weeks or months and is not guaranteed." },
            { label: "Patient Signature", mod_type: "signature", required: true },
        ]
    },

    // Form 1: Weight Loss Program
    {
        name: "Weight Loss Program Agreement",
        description: "Intake form for patients entering the medically-managed weight loss program",
        questions: [
            { label: "Current Weight (lbs)", mod_type: "number", required: true },
            { label: "Goal Weight (lbs)", mod_type: "number", required: true },
            { label: "Weight Loss History", mod_type: "textarea", required: false, description: "Please describe previous weight loss attempts" },
            { label: "Medical Conditions Affecting Weight", mod_type: "textarea", required: false },
            { label: "Current Medications", mod_type: "textarea", required: true },
            { label: "Dietary Restrictions", mod_type: "textarea", required: false },
            { label: "Food Allergies", mod_type: "textarea", required: false },
            { label: "Preferred Eating Style", mod_type: "radio", required: true, options: ["Keto", "Low-Carb", "Mediterranean", "Balanced", "Other"] },
            { label: "Weekly Weigh-in Commitment", mod_type: "checkbox", required: true, description: "I commit to weekly weigh-ins at the clinic or via home scale" },
            { label: "Nutrition Tracking Agreement", mod_type: "checkbox", required: true, description: "I agree to track daily nutrition using provided app" },
            { label: "Program Understanding", mod_type: "checkbox", required: true, description: "I understand this is a medically-supervised program requiring regular check-ins" },
            { label: "Patient Signature", mod_type: "signature", required: true },
        ]
    },

    // Form 2: EvexiPel Procedure
    {
        name: "EvexiPel Pelleting Informed Consent",
        description: "Informed consent for hormone pelleting procedure",
        questions: [
            { label: "Have you had hormone pellets before?", mod_type: "radio", required: true, options: ["Yes", "No"] },
            { label: "If yes, date of last pelleting", mod_type: "date", required: false },
            { label: "Current Hormone Medications", mod_type: "textarea", required: true, description: "List all current hormone replacement medications" },
            { label: "Recent Hormone Lab Results", mod_type: "file", required: false, description: "Upload your most recent lab results if available" },
            { label: "Procedure Risks Understood", mod_type: "checkbox", required: true, description: "I understand the risk of infection" },
            { label: "Pellet Extrusion Risk", mod_type: "checkbox", required: true, description: "I understand pellets may extrude and require removal" },
            { label: "Activity Restrictions Acknowledged", mod_type: "checkbox", required: true, description: "I will follow 24-72 hour activity restrictions post-procedure" },
            { label: "Cost Acknowledged", mod_type: "checkbox", required: true, description: "I acknowledge cost of $400 (female) or $700 (male)" },
            { label: "Follow-up Agreement", mod_type: "checkbox", required: true, description: "I agree to schedule 6-month follow-up appointment" },
            { label: "Patient Signature", mod_type: "signature", required: true },
        ]
    },

    // Form 3: Primary Care Membership
    {
        name: "Primary Care Membership Agreement",
        description: "Membership enrollment for Primary Care services",
        questions: [
            { label: "Membership Tier", mod_type: "radio", required: true, options: ["Elite Membership", "Premier Membership", "TCMH Membership"] },
            { label: "Chronic Conditions", mod_type: "checkbox", required: false, options: ["Diabetes", "Hypertension", "Heart Disease", "Asthma", "COPD", "None"] },
            { label: "Current Medications", mod_type: "textarea", required: true, description: "List all current medications with dosages" },
            { label: "Known Allergies", mod_type: "textarea", required: true, description: "List all known drug and environmental allergies" },
            { label: "Family Medical History", mod_type: "textarea", required: false },
            { label: "Last Physical Exam Date", mod_type: "date", required: false },
            { label: "Last Lab Work Date", mod_type: "date", required: false },
            { label: "Emergency Contact Name", mod_type: "text", required: true },
            { label: "Emergency Contact Phone", mod_type: "phone", required: true },
            { label: "Emergency Contact Relationship", mod_type: "text", required: true },
            { label: "Monthly Fee Understanding", mod_type: "checkbox", required: true, description: "I understand the monthly membership fee for my selected tier" },
            { label: "Cancellation Policy", mod_type: "checkbox", required: true, description: "I understand I may cancel with 30 days written notice" },
            { label: "Auto-Renewal Agreement", mod_type: "checkbox", required: true, description: "I agree to auto-renewal of membership unless I provide written cancellation" },
            { label: "Member Signature", mod_type: "signature", required: true },
        ]
    },

    // Form 4: Urgent Care
    {
        name: "Urgent Care Chief Complaint",
        description: "Quick intake for urgent care walk-in visits",
        questions: [
            { label: "What brings you in today?", mod_type: "textarea", required: true, description: "Describe your chief complaint" },
            { label: "How long have you had these symptoms?", mod_type: "text", required: true },
            { label: "Symptom Severity (1-10)", mod_type: "number", required: true, description: "Rate pain/severity from 1 (mild) to 10 (severe)" },
            { label: "Current Medications", mod_type: "textarea", required: true, description: "List any medications you're currently taking" },
            { label: "Known Allergies", mod_type: "textarea", required: true, description: "List any drug or environmental allergies" },
            { label: "HIPAA Privacy Notice", mod_type: "checkbox", required: true, description: "I acknowledge receipt of HIPAA privacy notice" },
        ]
    },

    // Form 5: ABX Tactical
    {
        name: "ABX Tactical Services Agreement",
        description: "Tactical medicine consultation and antibiotic pack authorization",
        questions: [
            { label: "Occupation", mod_type: "text", required: true },
            { label: "Professional Background", mod_type: "radio", required: true, options: ["First Responder", "Military (Active)", "Military (Reserve)", "Law Enforcement", "Other"] },
            { label: "Training and Certifications", mod_type: "textarea", required: false, description: "List relevant medical/tactical training and certifications" },
            { label: "Deployment Status", mod_type: "radio", required: true, options: ["Active Deployment", "Reserve/Training", "Civilian"] },
            { label: "Antibiotic Pack Authorization", mod_type: "checkbox", required: true, description: "I authorize prescription of tactical antibiotic pack for emergency use" },
            { label: "Self-Administration Training", mod_type: "checkbox", required: true, description: "I have completed or will complete self-administration training" },
            { label: "Emergency Use Understanding", mod_type: "checkbox", required: true, description: "I understand these medications are for emergency use only and require provider notification" },
            { label: "Liability Waiver", mod_type: "checkbox", required: true, description: "I understand and assume responsibility for proper use of tactical medications" },
            { label: "Participant Signature", mod_type: "signature", required: true },
        ]
    },
];

// ===== API FUNCTIONS =====

async function executeGraphQL(query: string): Promise<any> {
    const apiKey = process.env.HEALTHIE_API_KEY;

    if (!apiKey) {
        throw new Error('HEALTHIE_API_KEY environment variable not set');
    }

    const response = await fetch(HEALTHIE_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${apiKey}`,
            'AuthorizationSource': 'API',
        },
        body: JSON.stringify({ query }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (result.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
}

async function createForm(formDef: FormDefinition): Promise<string> {
    console.log(`\n📝 Creating form: ${formDef.name}`);

    // Step 1: Create form template
    const createFormMutation = `
    mutation CreateForm {
      createCustomModuleForm(input: {
        form_name: "${formDef.name.replace(/"/g, '\\"')}"
        use_for_charting: false
        use_for_program: false
      }) {
        customModuleForm {
          id
          name
        }
        messages {
          field
          message
        }
      }
    }
  `;

    const formResult = await executeGraphQL(createFormMutation);

    if (formResult.createCustomModuleForm.messages?.length > 0) {
        const messages = formResult.createCustomModuleForm.messages
            .map((m: any) => `${m.field}: ${m.message}`)
            .join(', ');
        throw new Error(`Form creation failed: ${messages}`);
    }

    const formId = formResult.createCustomModuleForm.customModuleForm.id;
    console.log(`  ✅ Form created (ID: ${formId})`);

    // Step 2: Add questions to form
    console.log(`  📋 Adding ${formDef.questions.length} questions...`);

    for (let i = 0; i < formDef.questions.length; i++) {
        const question = formDef.questions[i];

        const optionsField = question.options
            ? `, options: ${JSON.stringify(question.options.join(','))}`
            : '';

        const descField = question.description
            ? `, description: "${question.description.replace(/"/g, '\\"')}"`
            : '';

        const addQuestionMutation = `
      mutation AddQuestion {
        createCustomModule(input: {
          custom_module_form_id: "${formId}"
          label: "${question.label.replace(/"/g, '\\"')}"
          mod_type: "${question.mod_type}"
          required: ${question.required}
          ${descField}
          ${optionsField}
        }) {
          customModule {
            id
            label
          }
          messages {
            field
            message
          }
        }
      }
    `;

        const questionResult = await executeGraphQL(addQuestionMutation);

        if (questionResult.createCustomModule.messages?.length > 0) {
            console.log(`    ⚠️  Question ${i + 1} warning: ${questionResult.createCustomModule.messages[0].message}`);
        } else {
            console.log(`    ✅ Added: ${question.label}`);
        }

        // Rate limiting: small delay between requests
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    return formId;
}

// ===== MAIN EXECUTION =====

async function main() {
    console.log('🏥 Granite Mountain Health - Healthie Form Creator\n');
    console.log(`📊 Forms to create: ${forms.length}\n`);

    const createdForms: Array<{ name: string; id: string; questionCount: number }> = [];

    for (const formDef of forms) {
        try {
            const formId = await createForm(formDef);
            createdForms.push({
                name: formDef.name,
                id: formId,
                questionCount: formDef.questions.length
            });

            // Longer delay between forms to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error(`\n❌ Failed to create "${formDef.name}":`, error);
            console.error('Stopping execution.\n');
            break;
        }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📈 SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Forms created: ${createdForms.length}/${forms.length}\n`);

    if (createdForms.length > 0) {
        console.log('Created forms:');
        for (const form of createdForms) {
            console.log(`  - ${form.name} (ID: ${form.id}, ${form.questionCount} questions)`);
        }
    }

    if (createdForms.length === forms.length) {
        console.log('\n🎉 All forms created successfully!');
        console.log('\n📋 Next Steps:');
        console.log('1. Log into Healthie and verify forms in Settings > Forms');
        console.log('2. Configure Smart Fields for each form (see workflow_execution_guide.md)');
        console.log('3. Create intake flows and add these forms (see workflow_execution_guide.md)');
    }
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
