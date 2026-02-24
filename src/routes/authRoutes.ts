import { Router } from 'express';
import { registerStep, login, verifyEmail, checkEmail, getProfile } from '../controllers/authController'; 
import { authenticateToken } from '../middlewares/authMiddleware'; 
const router = Router();

router.post('/check-email', checkEmail);
router.post('/register', registerStep);
router.post('/login', login);
router.post('/verify-email', verifyEmail);

router.get('/profile', authenticateToken, getProfile); 

export default router;