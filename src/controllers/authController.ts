import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { sendVerificationEmail } from '../services/emailService';
import { AuthRequest } from '../middlewares/authMiddleware';

const SALT_ROUNDS = 10;


export const getProfile = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId; 

        if (!userId) {
            return res.status(401).json({ success: false, message: "Usuario no identificado" });
        }

        const userQuery = `
            SELECT 
                u.id_user as id, u.email, u.first_name, u.last_name, u.birth_date, u.city, u.description,
                COALESCE(json_agg(DISTINCT p.url_photo) FILTER (WHERE p.url_photo IS NOT NULL), '[]') as photos,
                COALESCE(json_agg(DISTINCT i.name) FILTER (WHERE i.name IS NOT NULL), '[]') as interests,
                COALESCE(json_agg(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL), '[]') as neurodivergences
            FROM users u
            LEFT JOIN photo p ON u.id_user = p.id_user
            LEFT JOIN user_interest ui ON u.id_user = ui.id_user
            LEFT JOIN interest i ON ui.id_interest = i.id_interest
            LEFT JOIN user_feature uf ON u.id_user = uf.id_user
            LEFT JOIN feature f ON uf.id_feature = f.id_feature
            WHERE u.id_user = $1
            GROUP BY u.id_user
        `;

        const result = await pool.query(userQuery, [userId]);
        
        res.status(200).json({
            success: true,
            user: result.rows[0]
        });
    } catch (error) {
        console.error("❌ Error al obtener perfil:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    }
};

/**
 * 1. VERIFICAR DISPONIBILIDAD DE EMAIL
 * Se usa en el frontend mientras el usuario escribe su correo.
 */
export const checkEmail = async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: "Email requerido" });

        const result = await pool.query('SELECT id_user FROM users WHERE email = $1', [email]);
        
        if (result.rows.length > 0) {
            return res.status(409).json({ exists: true, message: "El email ya está registrado" });
        }
        
        return res.status(200).json({ exists: false, message: "Email disponible" });
    } catch (error) {
        console.error("Error en checkEmail:", error);
        res.status(500).json({ success: false, message: "Error al verificar email" });
    }
};

/**
 * 2. REGISTRO INICIAL (Pre-verificación)
 * Guarda los datos, cifra la clave y envía el código OTP.
 */
export const registerStep = async (req: Request, res: Response) => {
    const client = await pool.connect();
    
    try {
        const { 
            email, password, firstName, lastName, birthDate, 
            gender, sexuality, city, description, interests, 
            neurodivergences, photos 
        } = req.body;

        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        await client.query('BEGIN');

        // INSERT corregido con los nombres de columna REALES de tu DB
        const userQuery = `
            INSERT INTO users (
                email, password, first_name, last_name, birth_date, 
                id_gender, id_preference, city, description,
                verification_code, code_expires_at, is_verified, role
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id_user
        `;

        const userValues = [
            email, hashedPassword, firstName, lastName, birthDate,
            gender,     // Ahora es un ID numérico
            sexuality,  // Ahora es un ID numérico
            city, description,
            verificationCode, expiresAt, false, 'user'
        ];

        const newUser = await client.query(userQuery, userValues);
        const userId = newUser.rows[0].id_user;

        // Inserción de intereses (IDs numéricos)
        if (interests && interests.length > 0) {
            for (const interestId of interests) {
                await client.query(
                    'INSERT INTO user_interest (id_user, id_interest) VALUES ($1, $2)',
                    [userId, interestId]
                );
            }
        }

        // Inserción de features/neurodivergencias (IDs numéricos)
        if (neurodivergences && neurodivergences.length > 0) {
            for (const featureId of neurodivergences) {
                await client.query(
                    'INSERT INTO user_feature (id_user, id_feature) VALUES ($1, $2)', 
                    [userId, featureId]
                );
            }
        }

        // Inserción de photos
        if (photos && Array.isArray(photos)) {
            for (let i = 0; i < photos.length; i++) {
                const photoData = photos[i];
                
                if (photoData) { 
                    const isPrimary = (i === 0); 

                    await client.query(
                        'INSERT INTO photo (id_user, url_photo, is_primary) VALUES ($1, $2, $3)', 
                        [userId, photoData, isPrimary]
                    );
                }
            }
        }

        await client.query('COMMIT');

        try {
            await sendVerificationEmail(email, verificationCode);
        } catch (error){
            if (error instanceof Error) {
                console.log("Error al enviar email, pero seguimos adelante:", error.message);
            } else {
                console.log("Ocurrió un error desconocido al enviar el email");
            }
        }
        

        res.status(201).json({
            success: true,
            message: "Usuario registrado. Código enviado al email.",
            userId 
        });

    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error("❌ Error en registro:", error);
        res.status(500).json({ success: false, message: error.message || "Error en el servidor" });
    } finally {
        client.release();
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        console.log("Generando token para el usuario ID:", user.id_user);

        const token = jwt.sign(
            { 
                userId: user.id_user, 
                role: user.role 
            }, 
            process.env.JWT_SECRET as string,
            { expiresIn: '24h' }
        );

        res.status(200).json({
            success: true,
            message: "Login exitoso",
            token,
            user: { 
                id: user.id_user, 
                firstName: user.first_name, 
                email: user.email 
            }
        });

    } catch (error) {
        console.error("❌ Error en login:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
};

/**
 * 3. VERIFICACIÓN DE EMAIL Y ENTREGA DE JWT
 * Valida el código y activa la cuenta del usuario.
 */
export const verifyEmail = async (req: Request, res: Response) => {
    /*
    try {
        const { userId, code } = req.body;

        const result = await pool.query(
            'SELECT verification_code, code_expires_at FROM users WHERE id_user = $1',
            [userId]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }

        // Validar código y tiempo
        const isCodeValid = user.verification_code === code;
        const isNotExpired = new Date() < new Date(user.code_expires_at);

        if (!isCodeValid || !isNotExpired) {
            return res.status(400).json({ 
                success: false, 
                message: !isCodeValid ? "Código incorrecto" : "El código ha expirado" 
            });
        }

        // Activar cuenta y limpiar campos de verificación
        await pool.query(
            'UPDATE users SET is_verified = true, verification_code = NULL, code_expires_at = NULL WHERE id_user = $1',
            [userId]
        );

        // Generar JWT final
        const token = jwt.sign(
            { userId: userId }, 
            process.env.JWT_SECRET as string, 
            { expiresIn: '24h' }
        );

        res.status(200).json({
            success: true,
            message: "Email verificado correctamente",
            token
        });

    } catch (error) {
        console.error("Error en verificación:", error);
        res.status(500).json({ success: false, message: "Error interno en la verificación" });
    }
    */

    return res.status(200).json({ 
        success: true, 
        message: "Verificación saltada para pruebas" 
    });
};