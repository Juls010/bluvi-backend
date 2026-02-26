import { pool } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';
import { Response } from 'express';


export const getProfile = async (req: AuthRequest, res: Response) => {
    try {
        // Ahora TypeScript sabe que req.user existe y tiene userId
        const userId = req.user?.userId; 

        if (!userId) {
            return res.status(401).json({ success: false, message: "Usuario no identificado" });
        }

        const userQuery = `
            SELECT 
                u.id, u.email, u.first_name, u.last_name, u.birth_date, u.city, u.description,
                COALESCE(json_agg(DISTINCT p.url_photo) FILTER (WHERE p.url_photo IS NOT NULL), '[]') as photos,
                COALESCE(json_agg(DISTINCT i.name) FILTER (WHERE i.name IS NOT NULL), '[]') as interests,
                COALESCE(json_agg(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL), '[]') as neurodivergences
            FROM users u
            LEFT JOIN photo p ON u.id = p.id_user
            LEFT JOIN user_interest ui ON u.id = ui.id_user
            LEFT JOIN interest i ON ui.id_interest = i.id_interest
            LEFT JOIN user_feature uf ON u.id = uf.id_user
            LEFT JOIN feature f ON uf.id_feature = f.id_feature
            WHERE u.id = $1
            GROUP BY u.id
        `;

        const result = await pool.query(userQuery, [userId]);
        
        res.status(200).json({
            success: true,
            user: result.rows[0]
        });
    } catch (error) {
        console.error("Error al obtener perfil:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    }
};

export const getExploreUsers = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        
        // 1. Capturamos los filtros que vienen de la URL (ej: ?city=Madrid&feature=TDAH)
        const { city, feature, sensory } = req.query;

        // 2. Base de la query
        let queryText = `
            SELECT 
                u.id, u.first_name, u.city, u.description,
                (SELECT url_photo FROM photo WHERE id_user = u.id LIMIT 1) as main_photo,
                COALESCE(json_agg(DISTINCT i.name) FILTER (WHERE i.name IS NOT NULL), '[]') as interests,
                COALESCE(json_agg(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL), '[]') as features
            FROM users u
            LEFT JOIN user_interest ui ON u.id = ui.id_user
            LEFT JOIN interest i ON ui.id_interest = i.id_interest
            LEFT JOIN user_feature uf ON u.id = uf.id_user
            LEFT JOIN feature f ON uf.id_feature = f.id_feature
            WHERE u.id != $1 AND u.is_verified = true
        `;

        const queryParams: any[] = [userId];
        let paramCount = 2;

        // 3. Aplicamos Filtro: Cercanía (por ahora por Ciudad)
        if (city) {
            queryText += ` AND u.city = $${paramCount}`;
            queryParams.push(city);
            paramCount++;
        }

        // 4. Aplicamos Filtro: Rasgos (Neurodivergencias)
        if (feature) {
            queryText += ` AND f.name = $${paramCount}`;
            queryParams.push(feature);
            paramCount++;
        }

        // 5. Aplicamos Filtro: Preferencias Sensoriales (Suponiendo que están en feature o una tabla similar)
        if (sensory) {
            queryText += ` AND f.name = $${paramCount}`; // Ajusta si tienes tabla 'sensory'
            queryParams.push(sensory);
            paramCount++;
        }

        queryText += ` GROUP BY u.id LIMIT 20`;

        const result = await pool.query(queryText, queryParams);

        res.status(200).json({
            success: true,
            count: result.rows.length,
            users: result.rows
        });

    } catch (error) {
        console.error("Error en explorar:", error);
        res.status(500).json({ success: false, message: "Error al filtrar usuarios" });
    }
};