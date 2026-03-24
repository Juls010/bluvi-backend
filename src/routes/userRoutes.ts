import { Router } from 'express';
import { getExploreUsers, getProfile, updateProfile, deleteAccount, getPrivacy, updatePrivacy, } from '../controllers/userController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, updateProfile);
router.get('/explore', authenticateToken, getExploreUsers);
router.delete('/profile', authenticateToken, deleteAccount);
router.get('/privacy',    authenticateToken, getPrivacy);
router.patch('/privacy',  authenticateToken, updatePrivacy);

export default router;