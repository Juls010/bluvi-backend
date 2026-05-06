
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkPending() {
    try {
        const res = await pool.query("SELECT id, email, first_name, status, created_at FROM deleted_users_emails WHERE status = 'pending'");
        console.log(`Correos pendientes encontrados: ${res.rows.length}`);
        res.rows.forEach(row => {
            console.log(`- ID: ${row.id}, Email: ${row.email}, Creado el: ${row.created_at}`);
        });
        
        const allRes = await pool.query("SELECT status, count(*) FROM deleted_users_emails GROUP BY status");
        console.log("\nResumen por estado:");
        allRes.rows.forEach(row => console.log(`- ${row.status}: ${row.count}`));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkPending();
