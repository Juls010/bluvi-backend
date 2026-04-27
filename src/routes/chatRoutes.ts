import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
    getConversations,
    getConversationMessages,
    markConversationRead,
    sendConversationMessage,
    checkUserOnlineStatus,
    markConversationDelivered,
    deleteConversation,
    reportUserInChat,
    block,
    getBlockedUsers,
    unblock,
    getMyReports,
} from '../controllers/chatController';

const router = Router();

router.get('/', authenticateToken, getConversations);
router.get('/blocked', authenticateToken, getBlockedUsers);
router.get('/:userId/messages', authenticateToken, getConversationMessages);
router.get('/:userId/online', authenticateToken, checkUserOnlineStatus);
router.post('/:userId/messages', authenticateToken, sendConversationMessage);
router.patch('/:userId/read', authenticateToken, markConversationRead);
router.patch('/:userId/delivered', authenticateToken, markConversationDelivered);
router.delete('/:userId', authenticateToken, deleteConversation);
router.post('/:userId/report', authenticateToken, reportUserInChat);
router.post('/:userId/block', authenticateToken, block);
router.delete('/:userId/block', authenticateToken, unblock);
router.get('/reports', authenticateToken, getMyReports);

export default router;
