import 'dotenv/config';
import bcrypt from 'bcrypt';
import { Pool, type PoolClient } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' || process.env.DATABASE_URL?.includes('supabase.co')
        ? { rejectUnauthorized: false }
        : false,
});

const seedCatalog = async (client: PoolClient, table: string, values: string[], columnName: string) => {
    for (const value of values) {
        await client.query(
            `INSERT INTO ${table} (${columnName}) VALUES ($1) ON CONFLICT (${columnName}) DO NOTHING`,
            [value]
        );
    }
};

const getIdByName = async (
    client: PoolClient,
    table: string,
    idColumn: string,
    nameColumn: string,
    name: string
) => {
    const result = await client.query(
        `SELECT ${idColumn} FROM ${table} WHERE ${nameColumn} = $1`,
        [name]
    );

    return result.rows[0]?.[idColumn] as number | undefined;
};

const runSeed = async () => {
    const client = await pool.connect();

    try {
        console.log('Iniciando carga de datos de prueba...');

        await client.query('BEGIN');

        await seedCatalog(client, 'interest', [
            'Comida', 'Historia', 'Anime', 'Salud', 'Naturaleza', 'Feminismo',
            'Deporte', 'Playa', 'Magia', 'Veganismo', 'Música', 'Mascotas',
            'LGTBIQ+', 'Matemáticas', 'Poliamor', 'Diseño', 'Moda', 'Trenes',
            'Ciencia ficción', 'Fotografía', 'Videojuegos', 'Humor', 'Viajes', 'Montaña',
            'Muñecos', 'Cosplay', 'Religión', 'Lectura', 'Comics', 'Tecnología', 'Picnic',
            'Puzzles', 'Paseos', 'Maquetas'
        ], 'name');

        await seedCatalog(client, 'feature', [
            'TDAH', 'Autismo', 'Dislexia', 'Altas capacidades', 'Ansiedad', 'Depresión'
        ], 'name');

        await seedCatalog(client, 'gender', [
            'Mujer', 'Hombre', 'No binario', 'Otro'
        ], 'name');

        await seedCatalog(client, 'preference', [
            'Mujer', 'Hombre', 'No binario', 'Todos'
        ], 'name');

        await seedCatalog(client, 'communication_style', [
            'Directo', 'Empático', 'Tranquilo', 'Divertido', 'Formal'
        ], 'name');

        const passwordHash = await bcrypt.hash('12345678', 10);

        const userResult = await client.query(
            `
            INSERT INTO users (
                email,
                password,
                first_name,
                last_name,
                birth_date,
                id_gender,
                id_preference,
                city,
                description,
                role,
                is_verified
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (email) DO UPDATE
            SET
                password = EXCLUDED.password,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                birth_date = EXCLUDED.birth_date,
                id_gender = EXCLUDED.id_gender,
                id_preference = EXCLUDED.id_preference,
                city = EXCLUDED.city,
                description = EXCLUDED.description,
                role = EXCLUDED.role,
                is_verified = EXCLUDED.is_verified
            RETURNING id_user
            `,
            [
                'test@bluvi.com',
                passwordHash,
                'Bluvi',
                'Tester',
                '1995-05-15',
                3,
                4,
                'Madrid',
                'Cuenta de prueba para validar la base de datos',
                'user',
                true,
            ]
        );

        const userId = userResult.rows[0]?.id_user;

        if (userId) {
            await client.query('DELETE FROM user_interest WHERE id_user = $1', [userId]);
            await client.query('DELETE FROM user_communication_style WHERE id_user = $1', [userId]);
            await client.query('DELETE FROM user_feature WHERE id_user = $1', [userId]);
            await client.query('DELETE FROM user_preference WHERE id_user = $1', [userId]);

            const animeId = await getIdByName(client, 'interest', 'id_interest', 'name', 'Anime');
            const musicId = await getIdByName(client, 'interest', 'id_interest', 'name', 'Música');
            const directId = await getIdByName(client, 'communication_style', 'id_communication', 'name', 'Directo');
            const empatheticId = await getIdByName(client, 'communication_style', 'id_communication', 'name', 'Empático');
            const adhdId = await getIdByName(client, 'feature', 'id_feature', 'name', 'TDAH');

            if (animeId) {
                await client.query('INSERT INTO user_interest (id_user, id_interest) VALUES ($1, $2)', [userId, animeId]);
            }

            if (musicId) {
                await client.query('INSERT INTO user_interest (id_user, id_interest) VALUES ($1, $2)', [userId, musicId]);
            }

            const preferenceId = await getIdByName(client, 'preference', 'id_preference', 'name', 'Todos');
            if (preferenceId) {
                await client.query('INSERT INTO user_preference (id_user, id_preference) VALUES ($1, $2)', [userId, preferenceId]);
            }

            if (directId) {
                await client.query('INSERT INTO user_communication_style (id_user, id_communication) VALUES ($1, $2)', [userId, directId]);
            }

            if (empatheticId) {
                await client.query('INSERT INTO user_communication_style (id_user, id_communication) VALUES ($1, $2)', [userId, empatheticId]);
            }

            if (adhdId) {
                await client.query('INSERT INTO user_feature (id_user, id_feature) VALUES ($1, $2)', [userId, adhdId]);
            }
        }

        await client.query('COMMIT');

        console.log('Datos de prueba cargados con éxito.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en el seeding:', error);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
};

runSeed();
