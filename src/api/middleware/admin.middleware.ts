import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.middleware";

export const adminOnly = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    console.log("[adminOnly] REJECTED — no req.user");
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  // Debug: log what we received
  console.log("[adminOnly] user:", JSON.stringify({
    id: req.user.id,
    role: req.user.role,
    roleName: req.user.roleName,
    _isAdminToken: req.user._isAdminToken,
    hasPermissions: req.user.permissions !== undefined,
  }));

  // ✅ Primary: adminProtect sets this when admin_token cookie was used
  if (req.user._isAdminToken === true) {
    return next();
  }

  const role = String(req.user.role || req.user.roleName || "").toLowerCase();
  const roleOk = role.includes("admin");
  const hasAdminPermissions = req.user.permissions !== undefined && req.user.permissions !== null;

  console.log("[adminOnly] roleOk:", roleOk, "| hasPermissions:", hasAdminPermissions);

  if (!roleOk && !hasAdminPermissions) {
    return res.status(403).json({ success: false, message: "Access denied. Admins only" });
  }

  next();
};


