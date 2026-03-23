import { Request, Response, NextFunction } from 'express';
// Siguiendo la guía, lo ideal es importar la verificación desde tus utils
import { verifyAccessToken } from '../services/jwt'; 

export interface AuthRequest extends Request {
    user?: any; // El profesor suele guardar el payload completo del token [cite: 140]
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    
    // La guía valida explícitamente que empiece por Bearer 
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ 
            detail: 'Token no proporcionado o formato incorrecto' 
        });
    }

    const token = authHeader.split(' ')[1]; 

    try {
        const decoded = verifyAccessToken(token);
        req.user = decoded; 
        
        next(); 
    } catch (error) {
        return res.status(401).json({ 
            detail: 'Token inválido o expirado' 
        });
    }
};