import { Router } from 'express';
import { registerStep, login, verifyEmail, checkEmail } from '../controllers/authController'; 
import { getRegisterMetadata } from '../controllers/catalogController';

const router = Router();

router.post('/check-email', checkEmail);
router.post('/register', registerStep);
router.post('/login', login);
router.post('/verify-email', verifyEmail);
router.get('/metadata', getRegisterMetadata);


export default router;