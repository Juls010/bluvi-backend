import { Request, Response } from 'express';
import { z } from 'zod';

const narrationSchema = z.object({
    text: z.string().trim().min(1).max(1800),
});

type EdgeVoice = {
    toAudio: (text: string, options?: { lang?: string }) => Promise<{
        data: Buffer;
        ext?: string;
        duration?: number;
    }>;
};

let voicePromise: Promise<EdgeVoice> | null = null;

const getVoice = async () => {
    if (!voicePromise) {
        voicePromise = import('voipi/edge-tts').then(({ EdgeTTS }) => new EdgeTTS({
            voice: process.env.VOIPI_VOICE || 'es-ES-ElviraNeural',
            rate: process.env.VOIPI_RATE || '-5%',
            pitch: process.env.VOIPI_PITCH || 'default',
            volume: process.env.VOIPI_VOLUME || 'default',
            outputFormat: process.env.VOIPI_OUTPUT_FORMAT || 'audio-24khz-48kbitrate-mono-mp3',
        }));
    }

    return voicePromise;
};

const contentTypeByExt: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
};

export const synthesizeNarration = async (req: Request, res: Response) => {
    try {
        const parsed = narrationSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: parsed.error.issues[0]?.message || 'Texto de narración inválido',
            });
        }

        const voice = await getVoice();
        const audio = await voice.toAudio(parsed.data.text, { lang: 'es' });
        const ext = audio.ext || 'mp3';

        res.setHeader('Content-Type', contentTypeByExt[ext] || 'audio/mpeg');
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.setHeader('X-Audio-Duration', String(audio.duration ?? ''));

        return res.status(200).send(audio.data);
    } catch (error) {
        console.error('[narration] Error generating narration:', error);
        return res.status(503).json({
            success: false,
            message: 'No se pudo generar la narración',
        });
    }
};
