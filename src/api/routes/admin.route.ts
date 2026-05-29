import express from "express";
import {
  adminLogin,
  createAdmin,
  createAdminRole,
  getAdminProfile,
} from "../controllers/admin.controller";
import { adjustUserWallet } from "../controllers/wallet.controller";
import { protect, adminProtect } from "../middleware/auth.middleware";
import { adminOnly } from "../middleware/admin.middleware";
const router = express.Router();
/* PUBLIC */
router.post("/admin-login", adminLogin);
/* PROTECTED ADMIN ROUTES */
router.post("/roles", adminProtect, adminOnly, createAdminRole);
router.post("/create", createAdmin);
router.get("/me", adminProtect, adminOnly, getAdminProfile);
router.post("/wallet/adjust", adminProtect, adminOnly, adjustUserWallet);

export default router;


