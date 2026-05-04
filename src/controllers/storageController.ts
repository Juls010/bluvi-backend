import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import { createSignedDownloadUrl } from '../services/storageService';

interface SignedUrlBody {
  bucket: string;
  filePath: string;
  expiresSeconds?: number;
}

export const signedUrl = async (req: AuthRequest, res: Response) => {
  try {
    const { bucket, filePath, expiresSeconds } = req.body as SignedUrlBody;
    if (!bucket || !filePath) {
      return res.status(400).json({ success: false, message: 'bucket and filePath are required' });
    }

    const url = await createSignedDownloadUrl(bucket, filePath, expiresSeconds || 60);
    return res.status(200).json({ success: true, url });
  } catch (error: any) {
    console.error('Error creating signed URL:', error?.message || error);
    return res.status(500).json({ success: false, message: error?.message || 'Error generating signed URL' });
  }
};

export default { signedUrl };
