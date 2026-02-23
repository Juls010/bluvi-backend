import { Router } from 'express';
import * as authController from '../controllers/authController';

const router = Router();

// 1. Verificar disponibilidad (se llama desde la vista de Email)
router.post('/check-email', authController.checkEmail);

// 2. Crear usuario y enviar código (se llama al final del formulario)
router.post('/register', authController.registerStep);

// 3. Confirmar código y recibir JWT (se llama en la pantalla de verificación)
router.post('/verify-email', authController.verifyEmail);

export default router;