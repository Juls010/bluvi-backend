import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/jwt'; 

export interface AuthRequest extends Request {
    user?: any; 
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader?.startsWith('Bearer ')) {
        console.log("❌ Formato de header incorrecto o ausente");
        return res.status(401).json({ detail: 'Formato incorrecto' });
    }

    const token = authHeader.split(' ')[1]; 

    try {
        const decoded = verifyAccessToken(token);

        // 1. Validamos si la verificación devolvió null (fallo de jwt.verify)
        if (!decoded) {
            console.log("❌ El servicio JWT devolvió NULL (Token inválido o expirado)");
            return res.status(401).json({ 
                detail: 'Token inválido',
                code: 'TOKEN_EXPIRED_OR_INVALID' 
            });
        }

        // 2. Ahora que sabemos que 'decoded' existe, leemos el sub
        console.log("✅ Token verificado. Usuario ID:", decoded.sub);
        req.user = decoded; 
        next(); 

    } catch (error: any) {
        // Este catch ahora solo atrapará errores inesperados (como fallos de base de datos, etc.)
        console.error("❌ ERROR CRÍTICO EN MIDDLEWARE:", error.message);
        
        return res.status(500).json({ 
            detail: 'Error interno en la autenticación',
            error: error.message 
        });
    }
};