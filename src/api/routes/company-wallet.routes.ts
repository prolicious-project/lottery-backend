import { Router } from "express";
import {
  getCompanyWallet,
  getCompanyWalletTransactions,
  getCompanyWalletStats,
  manualAdjustCompanyWallet,
  createCompanyFundingOrder,
  verifyCompanyFunding,
} from "../controllers/company-wallet.controller";
import { adminProtect } from "../middleware/auth.middleware";
import { adminOnly } from "../middleware/admin.middleware";

const router = Router();

// All routes are admin-only
router.use(adminProtect, adminOnly);

/**
 * GET /api/admin/company-wallet
 * Returns current company wallet balance.
 */
router.get("/", getCompanyWallet);

/**
 * GET /api/admin/company-wallet/stats
 * Returns P&L breakdown: total deposits collected, prizes paid, net revenue.
 */
router.get("/stats", getCompanyWalletStats);

/**
 * GET /api/admin/company-wallet/transactions
 * Full ledger, newest first. Optional ?type= and ?limit= query params.
 */
router.get("/transactions", getCompanyWalletTransactions);

/**
 * POST /api/admin/company-wallet/manual-adjust
 * Super-admin manual credit/debit adjustment.
 * Body: { amount: number, type: "deposit_credit"|"withdrawal_debit", note: string }
 */
router.post("/manual-adjust", manualAdjustCompanyWallet);

/**
 * POST /api/admin/company-wallet/funding/create-order
 * Create a Razorpay order for Company Funding (Admin only).
 */
router.post("/funding/create-order", createCompanyFundingOrder);

/**
 * POST /api/admin/company-wallet/funding/verify
 * Verify a Razorpay signature for Company Funding (Admin only).
 */
router.post("/funding/verify", verifyCompanyFunding);

export default router;
