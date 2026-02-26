import { query } from '../lib/db';

async function find() {
  const rows = await query(`
    SELECT id, patient_name, healthie_patient_id, healthie_document_id, document_type, status, approved_at, approved_by
    FROM lab_review_queue
    WHERE LOWER(patient_name) LIKE '%brown%'
    ORDER BY approved_at DESC NULLS LAST, id DESC
    LIMIT 5
  `);
  console.log('Labs with Brown:', JSON.stringify(rows, null, 2));
}
find().catch(console.error);
