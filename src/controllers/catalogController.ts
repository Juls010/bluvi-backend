import { Request, Response } from 'express';
import { pool } from '../config/db'; 

export const getRegisterMetadata = async (req: Request, res: Response) => {
    try {
        // Con pool, usamos pool.query directamente. 
        // Promise.all permite lanzar las 4 consultas a la vez para que vuele.
        
        const [interests, neuros, sexualities, genders, communications] = await Promise.all([
            pool.query('SELECT id_interest AS id, name FROM interest ORDER BY name ASC'),
            pool.query('SELECT id_feature AS id, name FROM feature ORDER BY name ASC'), // o neurodivergences
            pool.query('SELECT id_preference AS id, name FROM preference ORDER BY name ASC'),
            pool.query('SELECT id_gender AS id, name FROM gender ORDER BY name ASC'),
            pool.query('SELECT id_communication AS id, name FROM communication_style ORDER BY name ASC')
        ]);

        console.log("📊 Datos cargados de la DB:");
        console.log("- Intereses:", interests.rowCount);
        console.log("- Neuro:", neuros.rowCount);
        console.log("- Preferencias:", sexualities.rowCount);
        console.log("- Géneros:", genders.rowCount);

        res.json({
            success: true,
            data: {
                interests: interests.rows,
                neurodivergences: neuros.rows,
                sexualities: sexualities.rows,
                genders: genders.rows,
                communicationStyles: communications.rows
            }
        });
    } catch (error) {
        console.error("Error en getRegisterMetadata:", error);
        res.status(500).json({ 
            success: false, 
            message: "Error al obtener las opciones de registro" 
        });
    }
};