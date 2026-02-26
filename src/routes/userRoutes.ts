import { Router } from 'express';
import { getExploreUsers, getProfile } from '../controllers/userController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

// Todas las rutas de usuario irán protegidas
router.get('/profile', authenticateToken, getProfile); 
router.get('/explore', authenticateToken, getExploreUsers);

export default router;