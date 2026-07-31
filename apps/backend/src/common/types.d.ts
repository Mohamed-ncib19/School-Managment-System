export {};
declare module "express" {
  interface Request {
    user?: {
      id: string;
      email: string;
      role: string;
      full_name: string;
    };
  }
}
