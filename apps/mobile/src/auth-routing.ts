import { requestJson } from './api-errors';

export type UsernameSession = {
  token: string;
  expiresAt: string;
  username: string;
  internalEmail: string;
  approved: true;
  role: 'admin' | 'subscriber';
  maxDevices: number;
  activeDevices: number;
  subscriptionExpiresAt?: string | null;
};

export type AdminSession = {
  token: string;
  expiresAt: string;
  username: string;
};

type NormalLoginPayload = {
  username: string;
  password: string;
  installationId: string;
  deviceName: string;
  androidVersion: string;
};

type AdminLoginPayload = {
  username: string;
  password: string;
};

export function loginNormalUser(
  apiBase: string,
  payload: NormalLoginPayload
) {
  return requestJson<UsernameSession>(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function loginAdmin(
  apiBase: string,
  payload: AdminLoginPayload
) {
  return requestJson<AdminSession>(`${apiBase}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
