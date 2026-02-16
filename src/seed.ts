import { Pool } from 'pg';

const pool = new Pool({
    user: 'bluvi_user',
    host: '127.0.0.1',
    database: 'bluvi_database',
    password: 'bluvi_password',
    port: 5432,
});

const runSeed = async () => {
    try {
        console.log('🌱 Iniciando carga de datos de prueba...');

        const interests = [
            "Comida", "Historia", "Anime", "Salud", "Naturaleza", "Feminismo", 
            "Deporte", "Playa", "Magia", "Veganismo", "Música", "Mascotas",
            "LGTBIQ+", "Matemáticas", "Poliamor", "Diseño", "Moda", "Trenes",
            "Ciencia ficción", "Fotografía", "Videojuegos", "Humor", "Viajes", "Montaña",
            "Muñecos", "Cosplay", "Religión", "Lectura", "Comics", "Tecnología", "Picnic",
            "Puzzles", "Paseos", "Maquetas"
        ];
        
        for (const item of interests) {
        await pool.query('INSERT INTO interest (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [item]);
        }
        console.log('✅ Intereses insertados');


        const userResult = await pool.query(`
        INSERT INTO users (name, email, password_hash, birth_date, description_user, genre)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (email) DO NOTHING
        RETURNING id_user
        `, ['Bluvi Tester', 'test@bluvi.com', '123456', '1995-05-15', 'Me encanta programar y el café', 'No binario']);

        if (userResult.rows.length > 0) {
        const newUserId = userResult.rows[0].id_user;

        const interestResult = await pool.query("SELECT id_interest FROM interest WHERE name = 'Anime'");
        if (interestResult.rows.length > 0) {
            await pool.query('INSERT INTO user_interest (id_user, id_interest) VALUES ($1, $2) ON CONFLICT DO NOTHING', 
            [newUserId, interestResult.rows[0].id_interest]);
        }
        }

        console.log('Datos de prueba cargados con éxito!');
    } catch (err) {
        console.error('Error en el seeding:', err);
    } finally {
        await pool.end();
    }
};

runSeed();