import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { sendVerificationEmail } from '../services/emailService';

const SALT_ROUNDS = 10;

/**
 * 1. VERIFICAR DISPONIBILIDAD DE EMAIL
 * Se usa en el frontend mientras el usuario escribe su correo.
 */
export const checkEmail = async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: "Email requerido" });

        const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        
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

        // Generación de código de 6 dígitos y expiración (15 min)
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        await client.query('BEGIN');

        // Insertar usuario (is_verified = false por defecto)
        const userQuery = `
            INSERT INTO users (
                email, password, first_name, last_name, birth_date, 
                gender, sexuality, city, description, photos,
                verification_code, code_expires_at, is_verified
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id
        `;

        const userValues = [
            email, hashedPassword, firstName, lastName, birthDate, 
            gender, sexuality, city, description, photos,
            verificationCode, expiresAt, false
        ];

        const newUser = await client.query(userQuery, userValues);
        const userId = newUser.rows[0].id;

        // Inserción de intereses
        if (interests && interests.length > 0) {
            for (const interestId of interests) {
                await client.query(
                    'INSERT INTO user_interests (user_id, interest_id) VALUES ($1, $2)',
                    [userId, interestId]
                );
            }
        }

        // Inserción de neurodivergencias
        if (neurodivergences && neurodivergences.length > 0) {
            for (const neuroName of neurodivergences) {
                await client.query(
                    'INSERT INTO user_neurodivergences (user_id, neuro_name) VALUES ($1, $2)', 
                    [userId, neuroName]
                );
            }
        }

        await client.query('COMMIT');

        // Enviar email con el código (fuera de la transacción)
        await sendVerificationEmail(email, verificationCode);

        res.status(201).json({
            success: true,
            message: "Usuario registrado. Código enviado al email.",
            userId 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error en registro:", error);
        res.status(500).json({ success: false, message: "Error en el servidor durante el registro" });
    } finally {
        client.release();
    }
};

/**
 * 3. VERIFICACIÓN DE EMAIL Y ENTREGA DE JWT
 * Valida el código y activa la cuenta del usuario.
 */
export const verifyEmail = async (req: Request, res: Response) => {
    try {
        const { userId, code } = req.body;

        const result = await pool.query(
            'SELECT verification_code, code_expires_at FROM users WHERE id = $1',
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
            'UPDATE users SET is_verified = true, verification_code = NULL, code_expires_at = NULL WHERE id = $1',
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
};