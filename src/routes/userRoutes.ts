import { Router } from 'express';
import {
	getExploreUsers,
	getProfile,
	updateProfile,
	deleteAccount,
	getPrivacy,
	updatePrivacy,
	markDiscoverUserSeen,
	getUserProfile,
	getAccessibilityPreferences,
	updateAccessibilityPreferences,
} from '../controllers/userController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, updateProfile);
router.get('/explore', authenticateToken, getExploreUsers);
router.post('/discovery/seen', authenticateToken, markDiscoverUserSeen);
router.delete('/profile', authenticateToken, deleteAccount);
router.get('/privacy',    authenticateToken, getPrivacy);
router.patch('/privacy',  authenticateToken, updatePrivacy);
router.get('/accessibility', authenticateToken, getAccessibilityPreferences);
router.patch('/accessibility', authenticateToken, updateAccessibilityPreferences);
router.get('/:userId', authenticateToken, getUserProfile);

export default router;