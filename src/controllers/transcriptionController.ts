import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import { transcribeFromUrl } from '../services/transcriptionService';
import { pool } from '../config/db';
import { emitToUser } from '../services/socket';

interface TranscribeBody {
  audioUrl: string;
  language?: string;
  messageId?: number;
}

export const transcribe = async (req: AuthRequest, res: Response) => {
  try {
    const { audioUrl, language, messageId } = req.body as TranscribeBody;
    if (!audioUrl || typeof audioUrl !== 'string') {
      return res.status(400).json({ success: false, message: 'audioUrl is required' });
    }

    const text = await transcribeFromUrl(audioUrl, language || 'es');

    // If messageId is provided, validate permission and update the message row
    if (messageId && Number.isInteger(messageId) && messageId > 0) {
      const msgResult = await pool.query('SELECT id_message, id_chat, id_sender FROM message WHERE id_message = $1 LIMIT 1', [messageId]);
      if (msgResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Message not found' });
      }
      const msg = msgResult.rows[0];

      // Ensure requester is participant in the chat
      const chatResult = await pool.query('SELECT id_user1, id_user2 FROM chat WHERE id_chat = $1 LIMIT 1', [msg.id_chat]);
      const chatRow = chatResult.rows[0];
      const userId = Number(req.user?.sub);
      if (!chatRow || (chatRow.id_user1 !== userId && chatRow.id_user2 !== userId)) {
        return res.status(403).json({ success: false, message: 'No permission to update this message' });
      }

      const update = await pool.query(
        'UPDATE message SET transcript = $1 WHERE id_message = $2 RETURNING id_message, id_chat, id_sender, content, message_type, audio_url, duration_seconds, transcript, date_sent',
        [text, messageId]
      );

      const updatedMessage = update.rows[0];

      // Notify counterpart about transcript available
      const otherUserId = chatRow.id_user1 === userId ? chatRow.id_user2 : chatRow.id_user1;
      try {
        emitToUser(otherUserId, 'chat:message:transcript', { messageId: updatedMessage.id_message, transcript: updatedMessage.transcript });
      } catch (e) {
        // ignore emit failures
      }

      return res.status(200).json({ success: true, text, updatedMessage });
    }

    return res.status(200).json({ success: true, text });
  } catch (error: any) {
    const status = Number(error?.status || error?.response?.status || 500);
    const message = error?.message || 'Error transcribing audio';
    console.error('Error transcribing audio:', message);
    return res.status(status === 429 ? 429 : 500).json({ success: false, message });
  }
};

export default { transcribe };
