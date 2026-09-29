import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Exponential backoff helper
const exponentialBackoff = (retryCount) => {
  const baseDelay = 1000; // 1 second
  const maxDelay = 32000; // 32 seconds
  const delay = Math.min(baseDelay * Math.pow(2, retryCount - 1), maxDelay);
  return new Promise(resolve => setTimeout(resolve, delay));
};

// Handle token expiration
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const maxRetries = 3;
    const retryCount = originalRequest._retryCount || 0;

    // Handle 401 with exponential backoff
    if (error.response?.status === 401 && retryCount < maxRetries) {
      originalRequest._retryCount = retryCount + 1;

      try {
        await exponentialBackoff(retryCount + 1);
        
        const refreshToken = localStorage.getItem('refreshToken');
        const response = await axios.post(
          `${API_URL}/auth/refresh-token`,
          { refreshToken }
        );

        const { token } = response.data;
        useAuthStore.getState().updateToken(token);

        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      } catch (err) {
        useAuthStore.getState().logout();
        window.location.href = '/login';
        return Promise.reject(err);
      }
    }

    // Handle 429 (rate limit) with exponential backoff
    if (error.response?.status === 429 && retryCount < maxRetries) {
      originalRequest._retryCount = retryCount + 1;
      await exponentialBackoff(retryCount + 1);
      return api(originalRequest);
    }

    return Promise.reject(error);
  }
);

export default api;
