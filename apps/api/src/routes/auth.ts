import { Router } from "express";
import { getUserId, requireAuth } from "../middleware/auth.js";
import { authService } from "../services/authService.js";

export const authRouter = Router();

authRouter.post("/register", async (request, response) => {
  try {
    const { email, password } = request.body as { email?: string; password?: string };

    if (!email || !password) {
      response.status(400).json({
        error: "Email and password are required.",
      });
      return;
    }

    const result = await authService.register(email.trim().toLowerCase(), password);
    response.status(201).json(result);
  } catch (error) {
    console.error("Auth register failed", {
      email: typeof request.body?.email === "string" ? request.body.email : undefined,
      error,
    });
    response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to register account.",
    });
  }
});

authRouter.post("/login", async (request, response) => {
  try {
    const { email, password } = request.body as { email?: string; password?: string };

    if (!email || !password) {
      response.status(400).json({
        error: "Email and password are required.",
      });
      return;
    }

    const result = await authService.login(email.trim().toLowerCase(), password);
    response.json(result);
  } catch (error) {
    console.error("Auth login failed", {
      email: typeof request.body?.email === "string" ? request.body.email : undefined,
      error,
    });
    response.status(401).json({
      error: error instanceof Error ? error.message : "Unable to log in.",
    });
  }
});

authRouter.get("/me", requireAuth, async (request, response) => {
  const user = await authService.getUserById(getUserId(request));

  if (!user) {
    response.status(404).json({
      error: "User not found.",
    });
    return;
  }

  response.json({
    user: {
      id: user.id,
      email: user.email,
    },
  });
});
