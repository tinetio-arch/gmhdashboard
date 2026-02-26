
const { Pool } = require('pg');

const pool = new Pool({
    host: 'clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com',
    port: 5432,
    database: 'postgres',
    user: 'clinicadmin',
    password: 'or0p5g!JL65cY3Y-l6+V%&RC',
    ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
    try {
        console.log('Connecting to DB...');
        const client = await pool.connect();
        console.log('Connected!');

        // Check patients columns
        const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'patients'
      ORDER BY column_name;
    `);

        console.log('\n--- Columns in patients table ---');
        res.rows.forEach(row => {
            console.log(`${row.column_name} (${row.data_type})`);
        });

        // Check if lab_orders exists
        const resOrders = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'lab_orders'
      ORDER BY column_name;
    `);

        console.log('\n--- Columns in lab_orders table ---');
        resOrders.rows.forEach(row => {
            console.log(`${row.column_name} (${row.data_type})`);
        });

        // Search for Raymond in lab_orders
        console.log('\n--- Searching for "Raymond" in lab_orders ---');
        const searchRes = await client.query(`
        SELECT * FROM lab_orders 
        WHERE patient_first_name ILIKE '%raymond%' 
           OR patient_last_name ILIKE '%raymond%'
    `);
        console.log(`Found ${searchRes.rows.length} matches for Raymond:`);
        console.log(JSON.stringify(searchRes.rows, null, 2));


        client.release();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        pool.end();
    }
}

checkSchema();
