// API Configuration
const API_URL = import.meta.env.VITE_API_URL || '';

export const getApiUrl = (endpoint: string): string => {
  // In development, use proxy (empty API_URL)
  // In production, use the full backend URL
  return `${API_URL}${endpoint}`;
};

export const getWebSocketUrl = (endpoint: string): string => {
  // Convert HTTP(S) to WS(S) for WebSocket connections
  if (API_URL) {
    const wsUrl = API_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    return `${wsUrl}${endpoint}`;
  }
  // Development fallback
  return `ws://localhost:8001${endpoint}`;
};
