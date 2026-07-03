declare global {
  namespace Express {
    interface Request {
      actor?: string;
    }
  }
}

export {};
