import { Pool } from 'pg';

export const pool = new Pool({
    user: 'bluvi_user',
    host: '127.0.0.1',
    database: 'bluvi_database',
    password: 'bluvi_password',
    port: 5432,
});