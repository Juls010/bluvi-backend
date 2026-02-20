import { Request, Response } from 'express';
import { pool } from '../config/db';

export const getInterests = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM interest ORDER BY name ASC');
        res.json(result.rows); 
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener intereses' });
    }
};