import { Router } from 'express';
import { getExploreUsers, getProfile, updateProfile, deleteAccount } from '../controllers/userController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

// Todas las rutas de usuario irán protegidas
router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, updateProfile);
router.get('/explore', authenticateToken, getExploreUsers);
router.delete('/profile', authenticateToken, deleteAccount);

export default router;