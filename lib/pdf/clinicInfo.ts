/**
 * Clinic contact info for PDF letterhead, based on patient's clinic/group.
 */

export interface ClinicInfo {
    name: string;
    phone: string;
    fax: string;
    email: string;
    address: string;
    city: string;
}

const NOWMENSHEALTH: ClinicInfo = {
    name: 'NowOptimal Network',
    phone: '(928) 212-2772',
    fax: '(928) 350-6228',
    email: 'hello@nowoptimal.com',
    address: '215 N McCormick St',
    city: 'Prescott, AZ 86301',
};

const DEFAULT_CLINIC: ClinicInfo = {
    name: 'NowOptimal Network',
    phone: '(928) 277-0001',
    fax: '(928) 350-6228',
    email: 'hello@nowoptimal.com',
    address: '215 N McCormick St',
    city: 'Prescott, AZ 86301',
};

/**
 * Get clinic contact info based on patient's clinic field or client_type.
 */
export function getClinicInfo(clinicOrType?: string | null): ClinicInfo {
    const val = (clinicOrType || '').toLowerCase();
    if (val.includes('nowmenshealth') || val.includes('mens health') || val.includes('tcmh')) {
        return NOWMENSHEALTH;
    }
    return DEFAULT_CLINIC;
}
