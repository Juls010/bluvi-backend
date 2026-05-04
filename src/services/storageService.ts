import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_BUCKET = process.env.SUPABASE_AUDIO_BUCKET || 'bluvi-audio';

let supabase: SupabaseClient | null = null;

const getClient = () => {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY no configuradas en el backend');
  }

  supabase = createClient(url, key);
  return supabase;
};

export const getDefaultAudioBucket = () => DEFAULT_BUCKET;

export async function createSignedDownloadUrl(bucket: string, filePath: string, expiresSeconds = 60) {
  const client = getClient();
  const { data, error } = await client.storage.from(bucket).createSignedUrl(filePath, expiresSeconds);
  if (error) {
    throw error;
  }

  return data.signedUrl;
}

export async function uploadAudioToStorage(options: {
  bucket?: string;
  filePath: string;
  contentType: string;
  audioBuffer: Buffer;
}) {
  const client = getClient();
  const bucket = options.bucket || DEFAULT_BUCKET;

  const { data, error } = await client.storage.from(bucket).upload(options.filePath, options.audioBuffer, {
    contentType: options.contentType,
    upsert: false,
  });

  if (error) {
    throw error;
  }

  return data.path;
}

export function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export default { createSignedDownloadUrl, uploadAudioToStorage, getDefaultAudioBucket, isHttpUrl };
