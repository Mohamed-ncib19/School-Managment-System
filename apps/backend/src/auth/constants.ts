export const JWT_SECRET = () => process.env.JWT_SECRET ?? "fallback_secret_change_me";
export const JWT_EXPIRES_IN = () => process.env.JWT_EXPIRES_IN ?? "7d";
export const JWT_REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET ?? "fallback_refresh_secret_change_me";
export const JWT_REFRESH_EXPIRES_IN = () => process.env.JWT_REFRESH_EXPIRES_IN ?? "30d";
