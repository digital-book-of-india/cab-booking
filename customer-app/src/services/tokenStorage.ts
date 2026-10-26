import { AppStorage } from './storage';

const ACCESS_TOKEN_KEY = 'cab_access_token';
const REFRESH_TOKEN_KEY = 'cab_refresh_token';

export const TokenStorage = {
  async getAccessToken(): Promise<string | null> {
    return AppStorage.getItem(ACCESS_TOKEN_KEY);
  },

  async setAccessToken(token: string): Promise<void> {
    await AppStorage.setItem(ACCESS_TOKEN_KEY, token);
  },

  async getRefreshToken(): Promise<string | null> {
    return AppStorage.getItem(REFRESH_TOKEN_KEY);
  },

  async setRefreshToken(token: string): Promise<void> {
    await AppStorage.setItem(REFRESH_TOKEN_KEY, token);
  },

  async setTokens(accessToken: string, refreshToken: string): Promise<void> {
    await Promise.all([
      AppStorage.setItem(ACCESS_TOKEN_KEY, accessToken),
      AppStorage.setItem(REFRESH_TOKEN_KEY, refreshToken),
    ]);
  },

  async clearTokens(): Promise<void> {
    await Promise.all([
      AppStorage.removeItem(ACCESS_TOKEN_KEY),
      AppStorage.removeItem(REFRESH_TOKEN_KEY),
    ]);
  },
};
