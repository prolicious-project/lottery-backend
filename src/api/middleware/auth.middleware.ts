import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

export interface AuthRequest extends Request {
  user?: any;
}

export const protect = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  // ✅ User token takes priority. Fall back to admin_token only if no user token exists.
  // WHY: The browser sends BOTH cookies simultaneously. If admin_token is checked first,
  // the user payment flow gets authenticated as admin (which has no walletId),
  // breaking signature verification and wallet lookups.
  const token = req.cookies?.token || req.cookies?.admin_token;

  if (!req.cookies?.token && req.cookies?.admin_token) {
    console.log("[Auth] Admin token used (no user token present)");
  } else if (req.cookies?.token) {
    console.log("[Auth] User token used");
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized. Token missing",
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    );

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// adminProtect — use this instead of protect() on ALL admin routes.
// Checks admin_token FIRST so it is never shadowed by a regular user token
// when both cookies are present in the same browser session.
// ─────────────────────────────────────────────────────────────────────────────
export const adminProtect = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  // admin_token takes priority for admin routes
  const adminToken = req.cookies?.admin_token;
  const userToken = req.cookies?.token;
  const token = adminToken || userToken;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized. Admin token missing",
    });
  }

  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);
    req.user = decoded;
    // ✅ Tag whether we authenticated via admin_token cookie
    // adminOnly reads this flag — no role string matching needed
    req.user._isAdminToken = !!adminToken;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired admin token",
    });
  }
};