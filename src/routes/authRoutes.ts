import { Router } from 'express';
import { 
    registerStep, 
    login, 
    verifyEmail, 
    checkEmail, 
    refresh 
} from '../controllers/authController'; 
import { getRegisterMetadata } from '../controllers/catalogController';

const router = Router();


router.post('/check-email', checkEmail);
router.get('/metadata', getRegisterMetadata);
router.post('/register', registerStep);
router.post('/verify-email', verifyEmail);
router.post('/login', login);
router.post('/refresh', refresh);

export default router;