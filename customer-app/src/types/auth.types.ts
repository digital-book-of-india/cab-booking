export type UserRole = 'CUSTOMER' | 'DRIVER' | 'OPS' | 'SUPPORT' | 'FINANCE' | 'SUPER_ADMIN';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED';

export type AuthUser = {
  id: string;
  phone: string;
  role: UserRole;
  status: AccountStatus;
  profileComplete: boolean;
  isNewUser: boolean;
  name?: string | null;
  email?: string | null;
};

export type DeviceInfo = {
  platform?: string;
  deviceId?: string;
  appVersion?: string;
};

export type RequestOtpInput = {
  phone: string;
  purpose?: 'login';
};

export type RequestOtpResponse = {
  challengeId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

export type VerifyOtpInput = {
  challengeId: string;
  phone: string;
  otp: string;
  role?: 'CUSTOMER';
  device?: DeviceInfo;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
};

export type VerifyOtpResponse = AuthTokens & {
  user: AuthUser;
};

export type RefreshTokenInput = {
  refreshToken: string;
  device?: DeviceInfo;
};

export type UserSession = {
  id: string;
  device?: DeviceInfo | null;
  createdAt: string;
  lastUsedAt?: string | null;
  current: boolean;
};
