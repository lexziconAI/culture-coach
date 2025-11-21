/**
 * Converts a base64 string to a Uint8Array.
 */
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes a Uint8Array to a base64 string.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes raw PCM data into an AudioBuffer.
 * Assumes 16-bit integer PCM.
 */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number
): Promise<AudioBuffer> {
  // Use DataView to ensure correct endianness (Little Endian) and alignment
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const frameCount = Math.floor(data.byteLength / (numChannels * 2));
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Read Int16 (2 bytes) at the correct offset, little-endian
      const offset = (i * numChannels + channel) * 2;
      const int16 = dataView.getInt16(offset, true);
      // Convert Int16 to Float32 [-1.0, 1.0]
      channelData[i] = int16 / 32768.0;
    }
  }
  return buffer;
}

/**
 * Converts Float32 audio data (from Web Audio API) to Int16 PCM (for Gemini API).
 */
export function float32ToInt16(float32Data: Float32Array): Int16Array {
  const l = float32Data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    const s = Math.max(-1, Math.min(1, float32Data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}
