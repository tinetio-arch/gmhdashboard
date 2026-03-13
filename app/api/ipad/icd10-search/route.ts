import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Comprehensive ICD-10 code database (Men's Health + Common Primary Care)
const ICD10_DATABASE = [
    // Diabetes & Metabolic
    { code: 'E11.9', description: 'Type 2 Diabetes Mellitus without complications' },
    { code: 'E11.65', description: 'Type 2 Diabetes with Hyperglycemia' },
    { code: 'E11.22', description: 'Type 2 Diabetes with Diabetic Chronic Kidney Disease' },
    { code: 'E11.40', description: 'Type 2 Diabetes with Diabetic Neuropathy' },
    { code: 'E10.9', description: 'Type 1 Diabetes Mellitus without complications' },
    { code: 'E78.5', description: 'Hyperlipidemia, unspecified' },
    { code: 'E78.0', description: 'Pure Hypercholesterolemia' },
    { code: 'E78.1', description: 'Pure Hypertriglyceridemia' },
    { code: 'E78.2', description: 'Mixed Hyperlipidemia' },
    { code: 'E66.9', description: 'Obesity, unspecified' },
    { code: 'E66.01', description: 'Morbid (Severe) Obesity due to excess calories' },
    { code: 'E66.3', description: 'Overweight' },
    { code: 'R73.03', description: 'Prediabetes' },
    { code: 'E03.9', description: 'Hypothyroidism, unspecified' },
    { code: 'E05.90', description: 'Hyperthyroidism, unspecified' },

    // Cardiovascular
    { code: 'I10', description: 'Essential (Primary) Hypertension' },
    { code: 'I11.9', description: 'Hypertensive Heart Disease without heart failure' },
    { code: 'I25.10', description: 'Atherosclerotic Heart Disease of native coronary artery without angina' },
    { code: 'I25.2', description: 'Old Myocardial Infarction' },
    { code: 'I48.91', description: 'Atrial Fibrillation, unspecified' },
    { code: 'I34.1', description: 'Mitral Valve Prolapse' },
    { code: 'I50.9', description: 'Heart Failure, unspecified' },
    { code: 'R03.0', description: 'Elevated Blood Pressure reading' },

    // Men's Health Specific
    { code: 'E29.1', description: 'Testicular Hypofunction' },
    { code: 'N52.9', description: 'Erectile Dysfunction, unspecified' },
    { code: 'N52.01', description: 'Erectile Dysfunction due to arterial insufficiency' },
    { code: 'N40.0', description: 'Benign Prostatic Hyperplasia without lower urinary tract symptoms' },
    { code: 'N40.1', description: 'Benign Prostatic Hyperplasia with lower urinary tract symptoms' },
    { code: 'C61', description: 'Malignant Neoplasm of Prostate' },
    { code: 'N47.6', description: 'Balanoposthitis' },
    { code: 'N50.89', description: 'Other specified disorders of male genital organs' },

    // Mental Health
    { code: 'F41.1', description: 'Generalized Anxiety Disorder' },
    { code: 'F41.9', description: 'Anxiety Disorder, unspecified' },
    { code: 'F32.9', description: 'Major Depressive Disorder, single episode, unspecified' },
    { code: 'F33.0', description: 'Major Depressive Disorder, recurrent, mild' },
    { code: 'F33.1', description: 'Major Depressive Disorder, recurrent, moderate' },
    { code: 'F33.9', description: 'Major Depressive Disorder, recurrent, unspecified' },
    { code: 'F51.01', description: 'Primary Insomnia' },
    { code: 'F51.09', description: 'Other Insomnia' },
    { code: 'F43.10', description: 'Post-Traumatic Stress Disorder (PTSD)' },
    { code: 'F90.0', description: 'Attention-Deficit Hyperactivity Disorder (ADHD)' },

    // Respiratory
    { code: 'J20.9', description: 'Acute Bronchitis, unspecified' },
    { code: 'J06.9', description: 'Acute Upper Respiratory Infection, unspecified' },
    { code: 'J30.9', description: 'Allergic Rhinitis, unspecified' },
    { code: 'J45.909', description: 'Asthma, unspecified, uncomplicated' },
    { code: 'J44.9', description: 'Chronic Obstructive Pulmonary Disease (COPD), unspecified' },
    { code: 'G47.33', description: 'Obstructive Sleep Apnea' },
    { code: 'R06.02', description: 'Shortness of Breath' },
    { code: 'R05', description: 'Cough' },

    // Gastrointestinal
    { code: 'K21.9', description: 'Gastroesophageal Reflux Disease (GERD) without esophagitis' },
    { code: 'K21.0', description: 'GERD with Esophagitis' },
    { code: 'K59.00', description: 'Constipation, unspecified' },
    { code: 'K58.9', description: 'Irritable Bowel Syndrome without diarrhea' },
    { code: 'K76.0', description: 'Fatty (Change of) Liver, not elsewhere classified' },
    { code: 'R10.9', description: 'Abdominal Pain, unspecified' },
    { code: 'R11.0', description: 'Nausea' },

    // Musculoskeletal
    { code: 'M79.3', description: 'Panniculitis, unspecified' },
    { code: 'M25.50', description: 'Pain in unspecified joint' },
    { code: 'M54.5', description: 'Low Back Pain' },
    { code: 'M79.1', description: 'Myalgia (Muscle pain)' },
    { code: 'M81.0', description: 'Osteoporosis without current pathological fracture' },
    { code: 'M19.90', description: 'Osteoarthritis, unspecified' },

    // General Symptoms
    { code: 'R51', description: 'Headache' },
    { code: 'R50.9', description: 'Fever, unspecified' },
    { code: 'R53.83', description: 'Fatigue' },
    { code: 'R42', description: 'Dizziness and giddiness' },
    { code: 'R63.4', description: 'Abnormal weight loss' },
    { code: 'R63.5', description: 'Abnormal weight gain' },

    // Preventive & Screening
    { code: 'Z00.00', description: 'Encounter for general adult medical examination without abnormal findings' },
    { code: 'Z00.01', description: 'Encounter for general adult medical examination with abnormal findings' },
    { code: 'Z13.6', description: 'Encounter for screening for cardiovascular disorders' },
    { code: 'Z79.4', description: 'Long-term (current) use of insulin' },
    { code: 'Z79.899', description: 'Other long-term (current) drug therapy' },
    { code: 'Z79.84', description: 'Long-term (current) use of oral hypoglycemic drugs' },
    { code: 'Z68.41', description: 'Body Mass Index (BMI) 40.0-44.9, adult' },
    { code: 'Z68.42', description: 'Body Mass Index (BMI) 45.0-49.9, adult' },
    { code: 'Z87.891', description: 'Personal history of nicotine dependence' },
    { code: 'Z72.0', description: 'Tobacco use' },
    { code: 'F17.210', description: 'Nicotine Dependence, cigarettes, uncomplicated' },

    // Infections
    { code: 'B37.9', description: 'Candidiasis, unspecified' },
    { code: 'A09', description: 'Infectious Gastroenteritis' },
    { code: 'L03.90', description: 'Cellulitis, unspecified' },
    { code: 'N39.0', description: 'Urinary Tract Infection, site not specified' },
];

/**
 * GET /api/ipad/icd10-search?q=diabetes
 * Search ICD-10 codes by description or code
 */
export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');

        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q')?.toLowerCase().trim() || '';

        if (!query || query.length < 2) {
            return NextResponse.json({
                success: true,
                results: [],
                message: 'Enter at least 2 characters to search',
            });
        }

        // Search by code or description
        const results = ICD10_DATABASE
            .filter(item => {
                const descMatch = item.description.toLowerCase().includes(query);
                const codeMatch = item.code.toLowerCase().includes(query);
                return descMatch || codeMatch;
            })
            .slice(0, 20) // Limit to 20 results
            .map(item => ({
                code: item.code,
                description: item.description,
                display: `${item.code} — ${item.description}`,
            }));

        return NextResponse.json({
            success: true,
            results,
            query,
        });
    } catch (error) {
        console.error('[ICD10 Search] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Search failed' },
            { status: 500 }
        );
    }
}
