export const PASS_CONFIG = {
  1: { plan: 'PrimeCare Premier 50$/month', price: 50, type: 'primary_care', evaluate_clinicsync: true, payment_default: 'jane' },
  2: { plan: 'PrimeCare Elite 100$/month', price: 100, type: 'primary_care', evaluate_clinicsync: true, payment_default: 'jane' },
  3: { plan: 'Insurance Supplemental $60.00/month', price: 60, type: 'supplemental', evaluate_clinicsync: true, payment_default: 'jane',
       note: 'Often with 2nd membership (F&F/Pass 52 or TCMH/Pass 65/72)' },
  7: { plan: 'Dependent Membership $30.00/month', price: 30, type: 'dependent', evaluate_clinicsync: true, payment_default: 'jane',
       note: 'Limited to 2 Bunger children; pro-bono proxy' },
  52: { plan: 'Phil\'s F&F Testosterone Replacement Membership $140/month', price: 140, type: 'f_and_f_trt', evaluate_clinicsync: true, payment_default: 'jane',
        note: 'Friends & Family in Jane; common 2nd for supplemental' },
  65: { plan: 'TCMH Family 50$/Month', price: 50, type: 'family_tcmh', evaluate_clinicsync: true, payment_default: 'jane' },
  72: { plan: 'TCMH New Patient (On Peptides) $180/month', price: 180, type: 'new_patient_peptides', evaluate_clinicsync: true, payment_default: 'jane' },
  128: { plan: 'Primary Care - Premier - Pay for 1 Year', price: null, type: 'annual_premier', evaluate_clinicsync: true, payment_default: 'jane' }
};

export const KNOWN_PASS_IDS = Object.keys(PASS_CONFIG).map(Number);
