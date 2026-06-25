import type { NextFunction, Request, Response } from "express";
import { authService } from "../services/authService.js";

export type AuthedRequest = Request & {
  userId: string;
};

export const requireAuth = (request: Request, response: Response, next: NextFunction) => {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    response.status(401).json({
      error: "Missing authentication token.",
    });
    return;
  }

  try {
    const userId = authService.verifyToken(token);
    (request as AuthedRequest).userId = userId;
    next();
  } catch {
    response.status(401).json({
      error: "Invalid or expired authentication token.",
    });
  }
};

export const getUserId = (request: Request) => (request as unknown as AuthedRequest).userId;
