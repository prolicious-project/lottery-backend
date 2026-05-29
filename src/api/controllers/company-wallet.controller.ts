import { Request, Response } from "express";
import { db } from "../../db";
import { companyWallet, companyWalletTransactions, wallets, transactions, paymentOrders, users } from "../../db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { updateCompanyWallet } from "../../utils/company-wallet.util";
import Razorpay from "razorpay";
import crypto from "crypto";
import { getOrCreateSystemUser } from "./payment.controller";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "",
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/company-wallet
// Returns the current company wallet balance.
// ─────────────────────────────────────────────────────────────────────────────
export const getCompanyWallet = async (req: Request, res: Response) => {
  console.log("[getCompanyWallet] Controller reached ✅");
  try {
    const existing = await db
      .select()
      .from(companyWallet)
      .where(eq(companyWallet.slug, "main"))
      .limit(1);

    if (!existing.length) {
      // Wallet hasn't been bootstrapped yet (no deposits have occurred)
      return res.json({
        success: true,
        balance: 0,
        currency: "INR",
        message: "Company wallet not yet initialised (no deposits yet).",
      });
    }

    const wallet = existing[0];
    return res.json({
      success: true,
      balance: Number(wallet.balance),
      currency: wallet.currency,
      updatedAt: wallet.updatedAt,
    });
  } catch (error: any) {
    console.error("[CompanyWallet] getCompanyWallet error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch company wallet" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/company-wallet/transactions
// Returns the full company wallet ledger, newest first.
// Supports ?limit=N (default 50) and ?type=deposit_credit|prize_payout_debit|withdrawal_debit
// ─────────────────────────────────────────────────────────────────────────────
export const getCompanyWalletTransactions = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const typeFilter = req.query.type as string | undefined;

    let query = db
      .select()
      .from(companyWalletTransactions)
      .orderBy(desc(companyWalletTransactions.createdAt))
      .limit(limit) as any;

    if (typeFilter) {
      query = db
        .select()
        .from(companyWalletTransactions)
        .where(eq(companyWalletTransactions.type, typeFilter as any))
        .orderBy(desc(companyWalletTransactions.createdAt))
        .limit(limit);
    }

    const rows = await query;

    return res.json({ success: true, count: rows.length, transactions: rows });
  } catch (error: any) {
    console.error("[CompanyWallet] getCompanyWalletTransactions error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch company wallet transactions" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/company-wallet/stats
// Summarised P&L for the company wallet.
// ─────────────────────────────────────────────────────────────────────────────
export const getCompanyWalletStats = async (req: Request, res: Response) => {
  try {
    const [stats] = await db
      .select({
        totalDepositsCollected: sql<number>`
          COALESCE(SUM(
            CASE 
              WHEN ${companyWalletTransactions.type} = 'deposit_credit'
               AND ${companyWalletTransactions.note} LIKE 'Level Join%'
              THEN ${companyWalletTransactions.amount}::numeric 
              ELSE 0 
            END
          ), 0)
        `,
        totalPrizesPaid: sql<number>`
          COALESCE(SUM(CASE WHEN ${companyWalletTransactions.type} = 'prize_payout_debit'
                            THEN ${companyWalletTransactions.amount}::numeric ELSE 0 END), 0)
        `,
        totalWithdrawalsPaid: sql<number>`
          COALESCE(SUM(CASE WHEN ${companyWalletTransactions.type} = 'withdrawal_debit'
                            THEN ${companyWalletTransactions.amount}::numeric ELSE 0 END), 0)
        `,
      })
      .from(companyWalletTransactions)
      .leftJoin(transactions, eq(companyWalletTransactions.userTxnRef, transactions.txnRef))
      .leftJoin(users, eq(transactions.userId, users.id));

    const netRevenue =
      Number(stats.totalDepositsCollected) -
      Number(stats.totalPrizesPaid) -
      Number(stats.totalWithdrawalsPaid);

    return res.json({
      success: true,
      stats: {
        totalDepositsCollected: Number(stats.totalDepositsCollected),
        totalPrizesPaid: Number(stats.totalPrizesPaid),
        totalWithdrawalsPaid: Number(stats.totalWithdrawalsPaid),
        netRevenue,
      },
    });
  } catch (error: any) {
    console.error("[CompanyWallet] getCompanyWalletStats error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch company wallet stats" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/company-wallet/manual-adjust  (Admin only)
// Allows a super-admin to manually credit or debit the company wallet.
// Body: { amount: number, type: "deposit_credit"|"withdrawal_debit", note: string }
// ─────────────────────────────────────────────────────────────────────────────
export const manualAdjustCompanyWallet = async (req: Request, res: Response) => {
  try {
    const { amount, type, note } = req.body;

    if (!amount || !type || !note) {
      return res.status(400).json({ success: false, message: "amount, type, and note are required." });
    }

    const allowedTypes = ["deposit_credit", "withdrawal_debit"];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `type must be one of: ${allowedTypes.join(", ")}`,
      });
    }

    const result = await updateCompanyWallet(
      Number(amount),
      type,
      `[Manual Admin Adjustment] ${note}`
    );

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }

    return res.json({
      success: true,
      message: "Company wallet adjusted successfully.",
      newBalance: result.newBalance,
    });
  } catch (error: any) {
    console.error("[CompanyWallet] manualAdjust error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to adjust company wallet" });
  }
};

export const createCompanyFundingOrder = async (req: Request, res: Response) => {
  try {
    const { amount, currency = "INR" } = req.body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "Invalid funding amount" });
    }

    const options = {
      amount: Math.round(Number(amount) * 100), // paise
      currency,
      receipt: `fund_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);

    await db.transaction(async (tx) => {
      const systemUser = await getOrCreateSystemUser(tx);
      const [sysWallet] = await tx.select().from(wallets).where(eq(wallets.userId, systemUser.id)).limit(1);

      await tx.insert(paymentOrders).values({
        userId: systemUser.id,
        amount: Math.round(Number(amount) * 100),
        razorpayOrderId: order.id,
        status: "pending",
      });

      if (sysWallet) {
        await tx.insert(transactions).values({
          userId: systemUser.id,
          walletId: sysWallet.id,
          txnRef: order.id,
          amount: amount.toString(),
          type: "deposit",
          status: "pending",
          note: `Company Funding Order created`,
        });
      }
    });

    return res.status(200).json({ success: true, order });
  } catch (error: any) {
    console.error("[createCompanyFundingOrder] Error:", error);
    return res.status(500).json({ success: false, error: "Failed to create company funding order" });
  }
};

export const verifyCompanyFunding = async (req: Request, res: Response) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    const secret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
    const orderId  = (razorpay_order_id  || "").trim();
    const paymentId = (razorpay_payment_id || "").trim();
    const receivedSig = (razorpay_signature  || "").trim();

    const body = orderId + "|" + paymentId;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    if (expectedSignature !== receivedSig) {
      console.error("[verifyCompanyFunding] Signature mismatch for order:", orderId);
      return res.status(400).json({ success: false, error: "Invalid payment signature" });
    }

    await db.transaction(async (tx) => {
      const existingOrder = await tx.select().from(paymentOrders).where(eq(paymentOrders.razorpayOrderId, orderId));
      if (existingOrder.length === 0) {
        throw new Error(`Order ${orderId} not found in database.`);
      }
      
      if (existingOrder[0].status === "success") {
        console.log(`[verifyCompanyFunding] Order ${orderId} already marked success (Idempotency).`);
        return;
      }

      const exactAmountInPaise = existingOrder[0].amount;
      const amountToAddInRupees = Number((exactAmountInPaise / 100).toFixed(2));

      await tx.update(paymentOrders)
        .set({ status: "success" })
        .where(eq(paymentOrders.razorpayOrderId, orderId));

      await tx.update(transactions)
        .set({
          status: "success",
          gatewayTxnId: paymentId,
          note: `Company Funding verified: Frontend signature proven — ${paymentId}`,
        })
        .where(eq(transactions.txnRef, orderId));

      await updateCompanyWallet(
        amountToAddInRupees,
        "deposit_credit",
        `Company funding verified via Razorpay: ${paymentId}`,
        orderId,
        tx
      );
      console.log(`[verifyCompanyFunding] Company wallet funded ₹${amountToAddInRupees}`);
    });

    return res.status(200).json({
      success: true,
      message: "Company funding payment verified successfully."
    });
  } catch (error: any) {
    console.error("[verifyCompanyFunding] Error:", error);
    return res.status(500).json({ success: false, error: error.message || "Internal server error during verification" });
  }
};
