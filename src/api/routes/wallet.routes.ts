import express from "express";
import {
  getAllWallets,
  getUserWallet,
  getUserTransactions,
  payWithWallet
} from "../controllers/wallet.controller";

import { protect, adminProtect } from "../middleware/auth.middleware";
import { adminOnly } from "../middleware/admin.middleware";

const router = express.Router();

// ADMIN
router.get("/admin/all", adminProtect, adminOnly, getAllWallets);

// USER WALLET
router.get("/", protect, getUserWallet);
router.post("/pay", protect, payWithWallet);

// USER TRANSACTIONS
router.get("/transactions", protect, getUserTransactions);

export default router;

