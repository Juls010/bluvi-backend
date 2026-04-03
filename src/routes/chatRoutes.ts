import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
    getConversations,
    getConversationMessages,
    markConversationRead,
    sendConversationMessage,
    checkUserOnlineStatus,
} from '../controllers/chatController';

const router = Router();

router.get('/', authenticateToken, getConversations);
router.get('/:userId/messages', authenticateToken, getConversationMessages);
router.get('/:userId/online', authenticateToken, checkUserOnlineStatus);
router.post('/:userId/messages', authenticateToken, sendConversationMessage);
router.patch('/:userId/read', authenticateToken, markConversationRead);

export default router;
