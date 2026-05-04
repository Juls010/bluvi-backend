import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import { createSignedDownloadUrl, getDefaultAudioBucket, isHttpUrl } from './storageService';

const HUGGINGFACE_MODEL = process.env.HUGGINGFACE_TRANSCRIPTION_MODEL || 'openai/whisper-large-v3';
const HUGGINGFACE_API_TOKEN = process.env.HUGGINGFACE_API_TOKEN || process.env.HF_TOKEN;
const HUGGINGFACE_INFERENCE_URL = `https://router.huggingface.co/hf-inference/models/${HUGGINGFACE_MODEL}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const extractTranscriptionText = (data: any) => {
  if (!data) return null;
  if (typeof data === 'string') return data;
  if (typeof data.text === 'string') return data.text;
  if (Array.isArray(data) && typeof data[0]?.text === 'string') return data[0].text;
  return null;
};

export async function transcribeFromUrl(audioUrl: string, language = 'es') {
  if (!audioUrl) throw new Error('audioUrl is required');
  if (!HUGGINGFACE_API_TOKEN) throw new Error('HUGGINGFACE_API_TOKEN no configurada en el backend');

  const sourceUrl = isHttpUrl(audioUrl)
    ? audioUrl
    : await createSignedDownloadUrl(getDefaultAudioBucket(), audioUrl, 300);

  const tmpDir = os.tmpdir();
  const filename = `bluvi_audio_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(sourceUrl.split('?')[0]) || '.mp3'}`;
  const filePath = path.join(tmpDir, filename);

  const writer = fs.createWriteStream(filePath);

  let response;
  try {
    response = await axios.get(sourceUrl, { responseType: 'stream', timeout: 120_000 });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      throw new Error(
        status
          ? `No se pudo descargar el audio (HTTP ${status}). Revisa que la URL sea pública o firmada.`
          : 'No se pudo descargar el audio. Revisa la URL o la ruta del archivo.'
      );
    }

    throw error;
  }

  await new Promise<void>((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', () => resolve());
    writer.on('error', (err) => reject(err));
  });

  try {
    const audioBuffer = fs.readFileSync(filePath);
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const hfResponse = await axios.post(
          HUGGINGFACE_INFERENCE_URL,
          audioBuffer,
          {
            headers: {
              Authorization: `Bearer ${HUGGINGFACE_API_TOKEN}`,
              'Content-Type': 'audio/mpeg',
              Accept: 'application/json',
              'X-Wait-For-Model': 'true',
            },
            timeout: 180_000,
            validateStatus: () => true,
          }
        );

        if (hfResponse.status >= 200 && hfResponse.status < 300) {
          const text = extractTranscriptionText(hfResponse.data);
          if (!text) {
            throw new Error('Hugging Face no devolvió texto de transcripción');
          }

          return text;
        }

        let errorMessage = extractTranscriptionText(hfResponse.data) || hfResponse.data?.error || 'Error desconocido de Hugging Face';
        
        // If the error message is HTML, it's likely a 404 from the router/infrastructure
        if (typeof errorMessage === 'string' && errorMessage.includes('<!DOCTYPE html>')) {
          errorMessage = `Hugging Face Infrastructure Error (404/Not Found). Path: /models/${HUGGINGFACE_MODEL}`;
        }

        if (hfResponse.status === 503 && attempt < maxRetries) {
          const estimatedTime = Number(hfResponse.data?.estimated_time || 0);
          await sleep(Math.max(estimatedTime * 1000, 2000));
          continue;
        }

        const hfError = new Error(`Hugging Face no pudo transcribir el audio: ${errorMessage}`);
        (hfError as Error & { status?: number }).status = hfResponse.status;
        throw hfError;
      } catch (error: any) {
        if (attempt < maxRetries && error?.response?.status === 503) {
          const estimatedTime = Number(error?.response?.data?.estimated_time || 0);
          await sleep(Math.max(estimatedTime * 1000, 2000));
          continue;
        }

        throw error;
      }
    }

    throw new Error('No fue posible transcribir el audio con Hugging Face');
  } catch (error: any) {
    const status = Number(error?.status || error?.response?.status || 0);
    const message = String(error?.message || '');

    if (status === 401 || status === 403) {
      const authError = new Error('Hugging Face token inválido o sin permisos para el modelo');
      (authError as Error & { status?: number }).status = status;
      throw authError;
    }

    if (status === 429) {
      const rateLimitError = new Error('Hugging Face sin cuota disponible o limitando peticiones. Revisa tu plan.');
      (rateLimitError as Error & { status?: number }).status = 429;
      throw rateLimitError;
    }

    if (/quota|billing|current quota/i.test(message)) {
      const quotaError = new Error('Hugging Face sin cuota disponible. Revisa tu plan.');
      (quotaError as Error & { status?: number }).status = 429;
      throw quotaError;
    }

    throw error;
  } finally {
    // Best-effort cleanup
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      // noop
    }
  }
}

export default { transcribeFromUrl };
