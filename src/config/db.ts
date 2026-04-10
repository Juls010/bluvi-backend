import { Pool } from 'pg';

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' || process.env.DATABASE_URL?.includes('supabase.co')
        ? { rejectUnauthorized: false }
        : false,
    max: 10,
});