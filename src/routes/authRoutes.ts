import { Router } from 'express';
import { registerStep } from '../controllers/authController';

const router = Router();

// Esta ruta será: POST http://localhost:3000/api/auth/register-step
router.post('/register-step', registerStep);

export default router;