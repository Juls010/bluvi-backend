import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { sendVerificationEmail } from '../services/emailService';
import { AuthRequest } from '../middlewares/authMiddleware';
import { generateTokens, verifyRefreshToken } from '../services/jwt';

const SALT_ROUNDS = 10;

export const getProfile = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.sub; 

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
        console.error("Error al obtener perfil:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    }
};

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

export const registerStep = async (req: Request, res: Response) => {
        console.log("Datos recibidos en el Back:", req.body);
        const client = await pool.connect();
        
        try {
            const { 
                email, 
                password, 
                first_name,    
                last_name,    
                birth_date,    
                id_gender,     
                id_preference, 
                city, 
                description, 
                interests, 
                neurodivergences,
                communication_style, 
                photos 
            } = req.body;

            const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
            
            await client.query('BEGIN');

        const userQuery = `
            INSERT INTO users (
                email, password, first_name, last_name, birth_date, 
                id_gender, id_preference, city, description,
                verification_code, code_expires_at, is_verified, role
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id_user
        `;

        const userValues = [
            email.toLowerCase().trim(), 
            hashedPassword, 
            first_name, 
            last_name, 
            birth_date,
            id_gender, 
            id_preference, 
            city, 
            description,
            verificationCode, 
            expiresAt, 
            false, 
            'user'
        ];

        const newUser = await client.query(userQuery, userValues);
        const userId = newUser.rows[0].id_user;

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

        if (communication_style && Array.isArray(communication_style) && communication_style.length > 0) {
            for (const commId of communication_style) {
                await client.query(
                    'INSERT INTO user_communication_style (id_user, id_communication) VALUES ($1, $2)', 
                    [userId, commId]
                );
            }
        }

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
        console.error("Error en registro:", error);
        res.status(500).json({ success: false, message: error.message || "Error en el servidor" });
    } finally {
        client.release();
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;
        console.log("🔍 Intentando login para:", email);
        console.log("🔑 Password recibida del front:", password);

        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            console.log("❌ ERROR: El email no existe en la base de datos");
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        console.log("👤 Usuario encontrado en DB:", user.email);
        console.log("🔐 Hash en la DB:", user.password);

        const isMatch = await bcrypt.compare(password, user.password);
        console.log("⚖️ ¿Bcrypt dice que coinciden?:", isMatch);

        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        const tokens = generateTokens(user);

        res.status(200).json({
            success: true,
            message: "Login exitoso",
            ...tokens, 
            user: { 
                id: user.id_user, 
                firstName: user.first_name, 
                email: user.email 
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "Internal error" });
    }
};


export const refresh = async (req: Request, res: Response) => {
    const { refresh } = req.body;
    if (!refresh) return res.status(400).json({ message: 'Refresh token required' });

    try {
        const payload = verifyRefreshToken(refresh);
        
        const user = await pool.query('SELECT * FROM users WHERE id_user = $1', [payload.sub]);
        
        if (!user.rows[0]) return res.status(401).json({ message: 'User not found' });

        return res.json(generateTokens(user.rows[0]));
    } catch {
        return res.status(401).json({ detail: 'Invalid or expired refresh token' });
    }
};

export const verifyEmail = async (req: Request, res: Response) => {
    try {
        const { email, code } = req.body; 

        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND verification_code = $2',
            [email, code]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ success: false, message: "Invalid code" });
        }

        if (new Date() > new Date(user.code_expires_at)) {
            return res.status(400).json({ success: false, message: "The code has expired" });
        }

        await pool.query(
            'UPDATE users SET is_verified = true, verification_code = NULL, code_expires_at = NULL WHERE id_user = $1',
            [user.id_user]
        );

        const tokens = generateTokens(user);

        res.status(200).json({
            success: true,
            message: "Email address successfully verified",
            ...tokens
        });

    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ success: false, message: "Internal error" });
    }
};