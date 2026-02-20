import { Request, Response } from 'express';

export const registerStep = async (req: Request, res: Response) => {
    try {
        const userData = req.body;
        
        console.log("Datos recibidos del registro:", userData);

        res.status(200).json({
        message: "Datos recibidos correctamente",
        received: userData
        });
    } catch (error) {
        res.status(500).json({ message: "Error en el servidor", error });
    }
};