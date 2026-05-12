const { Pool } = require("pg");
const pool = new Pool({ host: process.env.DATABASE_HOST, port: process.env.DATABASE_PORT || 5432, database: process.env.DATABASE_NAME, user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, ssl: { rejectUnauthorized: false } });
const THRESHOLDS = [{ pattern: /hematocrit/i, threshold: 54 },{ pattern: /^hemoglobin$/i, threshold: 18 },{ pattern: /\bpsa\b$/i, threshold: 2.5 }];
async function run() {
    const { rows } = await pool.query("SELECT lrq.id, lrq.patient_name, lrq.raw_result, lrq.healthie_id, lrq.approved_by, lrq.collection_date, lrq.created_at as result_received_at, lrq.approved_at, p.patient_id FROM lab_review_queue lrq LEFT JOIN patients p ON p.healthie_client_id = lrq.healthie_id WHERE lrq.status = 'approved' AND lrq.raw_result IS NOT NULL AND lrq.approved_at >= NOW() - INTERVAL '7 days'");
    console.log("Labs:", rows.length);
    let n = 0;
    for (const lab of rows) {
        if (!lab.raw_result?.["Ordered Codes"]) continue;
        function ex(comps) { if (!Array.isArray(comps)) return; for (const c of comps) { if (c["Test Name"] && c["Result"]) { const v = parseFloat(c["Result"]); if (isNaN(v)) continue; for (const r of THRESHOLDS) { if (r.pattern.test(c["Test Name"]) && v > r.threshold) { const s = v > r.threshold*1.1 ? "critical" : "high"; pool.query("INSERT INTO critical_lab_alerts (lab_queue_id,patient_id,patient_name,test_name,test_value,test_units,reference_range,abnormal_flag,severity,ordering_provider,collection_date,result_received_at,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",[lab.id,lab.patient_id||null,lab.patient_name,c["Test Name"],c["Result"],c["Test Units"]||"",c["Range"]||"",c["Abnormal Flag"]||"",s,lab.approved_by||"Unknown",lab.collection_date||null,lab.result_received_at||null,lab.approved_at||null]).then(()=>{n++;console.log("OK:",lab.patient_name,c["Test Name"],v)}).catch(e=>console.error("ERR:",e.message)); }}} if (c["Components"]) ex(c["Components"]); }}
        for (const code of lab.raw_result["Ordered Codes"]) { if (code["Components"]) ex(code["Components"]); }
    }
    setTimeout(()=>{console.log("Total:",n);pool.end()},3000);
}
run();
