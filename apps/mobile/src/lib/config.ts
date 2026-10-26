/**
 * API base URL. Set EXPO_PUBLIC_API_URL in apps/mobile/.env to override,
 * e.g. your machine's LAN IP when testing on a physical phone.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
