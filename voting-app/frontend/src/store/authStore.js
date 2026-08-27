import create from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
  persist(
    (set) => ({
      token: localStorage.getItem('token') || null,
      refreshToken: localStorage.getItem('refreshToken') || null,
      user: localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')) : null,
      isAuthenticated: !!localStorage.getItem('token'),

      setAuth: (token, refreshToken, user) => {
        localStorage.setItem('token', token);
        localStorage.setItem('refreshToken', refreshToken);
        localStorage.setItem('user', JSON.stringify(user));
        set({
          token,
          refreshToken,
          user,
          isAuthenticated: true
        });
      },

      logout: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        set({
          token: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false
        });
      },

      updateUser: (user) => {
        localStorage.setItem('user', JSON.stringify(user));
        set({ user });
      },

      updateToken: (token) => {
        localStorage.setItem('token', token);
        set({ token });
      }
    }),
    {
      name: 'auth-storage'
    }
  )
);
