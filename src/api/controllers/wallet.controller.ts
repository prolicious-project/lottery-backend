import { db } from "../../db";
import { wallets, users, transactions, tickets, walletAdjustments } from "../../db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import crypto from "crypto";
import { updateCompanyWallet } from "../../utils/company-wallet.util";
import { emitPaymentUpdate, emitAdminTransaction, emitAdminStatsUpdate } from "../../utils/socket";

// ✅ GET ALL WALLETS (ADMIN)
export const getAllWallets = async (req: Request, res: Response) => {
  try {
    const data = await db
      .select({
        id: wallets.id,
        userId: wallets.userId,
        userName: users.name,
        balance: wallets.balance,
        bonus: wallets.bonusBalance,
        locked: wallets.lockedAmount,
        updatedAt: wallets.updatedAt,
      })
      .from(wallets)
      .leftJoin(users, eq(wallets.userId, users.id));

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No wallets found",
      });
    }

    const totalBalance = data.reduce(
      (sum, w: any) => sum + Number(w.balance || 0),
      0
    );

    const averageBalance = Math.floor(totalBalance / data.length);

    const transactionsToday = data.length;

    const lockedPrizes = data.reduce(
      (sum, w: any) => sum + Number(w.locked || 0),
      0
    );

    res.json({
      success: true,
      totalBalance,
      averageBalance,
      transactionsToday,
      lockedPrizes,
      wallets: data,
    });
  } catch (error) {
    console.error("Wallet Fetch Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch wallets",
    });
  }
};


// ✅ GET USER WALLET
export const getUserWallet = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    // 1. Disable Aggressive Browser Caching (Fixes 304 Not Modified issue during polling)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    // Priority: Query param (for polling support) or Auth token
    const userId = (req.query.userId as string) || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Not authorized",
        message: "User ID missing"
      });
    }

    let wallet = await db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1);

    // 2. RESILIENT PROVISIONING: Create wallet if missing (legacy users or broken registrations)
    if (!wallet.length) {
      console.log(`[Wallet] Provisioning missing wallet row on-demand for user ${userId}`);
      const [newWallet] = await db
        .insert(wallets)
        .values({
          userId: userId,
          balance: "0.00",
          lockedAmount: "0.00",
        })
        .returning();
      wallet = [newWallet];
    }

    res.json({
      success: true,
      available: Number(wallet[0].balance),
      locked: Number(wallet[0].lockedAmount),
    });

  } catch (error) {
    console.error("User Wallet Error:", error);

    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: "Failed to fetch wallet",
    });
  }
};


// ✅ GET USER TRANSACTIONS
export const getUserTransactions = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;

    const data = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt));

    res.json({
      success: true,
      transactions: data,
    });

  } catch (error) {
    console.error("Transactions Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
    });
  }
};

// ✅ PAY WITH WALLET (Unified Flow)
export const payWithWallet = async (req: AuthRequest, res: Response) => {
  const { drawId, ticketNumbers, totalAmount } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    await db.transaction(async (tx) => {
      // 1. Get Wallet
      const [userWallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId));

      if (!userWallet) {
        throw new Error("Wallet not found. Please try again.");
      }

      const balance = Number(userWallet.balance);
      if (balance < totalAmount) {
        throw new Error(`Insufficient balance. Available: ₹${balance}, Required: ₹${totalAmount}`);
      }

      // 2. Deduct Balance
      const newBalance = balance - totalAmount;
      await tx
        .update(wallets)
        .set({ balance: newBalance.toFixed(2), updatedAt: new Date() })
        .where(eq(wallets.id, userWallet.id));

      // 3. Create Tickets
      // ticketNumbers is a comma-separated string from frontend
      const ticketNumbersArray = ticketNumbers.split(",").map((s: string) => s.trim());
      const singleTicketPrice = totalAmount / ticketNumbersArray.length;

      for (const num of ticketNumbersArray) {
        await tx.insert(tickets).values({
          userId,
          drawId,
          ticketNumber: num,
          pricePaid: singleTicketPrice.toFixed(2),
          pickedNumbers: num,
          status: "active",
        });
      }

      // 4. Log Transaction
      const txnRef = `WLT-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
      await tx.insert(transactions).values({
        userId,
        walletId: userWallet.id,
        txnRef,
        amount: totalAmount.toFixed(2),
        type: "ticket_purchase",
        status: "success",
        note: `Wallet Purchase: Draw ${drawId}`,
      });

      // ── COMPANY WALLET: Ticket purchase credit (runs inside same tx) ──
      // FLOW: User Wallet -> Company Wallet
      await updateCompanyWallet(
        totalAmount,
        "deposit_credit",
        `Ticket Purchase: Draw ${drawId} via wallet`,
        txnRef,
        tx
      );
    });

    // Socket.io real-time update
    try {
      const [updatedWallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
      if (updatedWallet) {
        emitPaymentUpdate(userId, {
          status: "success",
          amount: totalAmount,
          available: Number(updatedWallet.balance),
          note: `Wallet Purchase: Draw ${drawId}`
        });
      }

      // Query the transaction just inserted to broadcast to admin
      const [newTxn] = await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.type, "ticket_purchase"))).orderBy(desc(transactions.createdAt)).limit(1);
      if (newTxn) {
        const typeMapping: Record<string, string> = {
          deposit: "Deposit",
          withdrawal: "Withdrawal",
          ticket_purchase: "TicketPurchase",
          prize_payout: "PrizePayout",
        };
        const statusMapping: Record<string, string> = {
          pending: "Pending",
          success: "Success",
          failed: "Failed",
        };
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        emitAdminTransaction({
          id: newTxn.id,
          userName: user?.name || "Unknown User",
          amount: newTxn.amount,
          type: typeMapping[newTxn.type] || newTxn.type,
          status: statusMapping[newTxn.status] || newTxn.status,
          method: "Wallet",
          datetime: newTxn.createdAt || new Date(),
        });
      }

      // Update admin stats
      const stats = await db.select({
        totalRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'ticket_purchase' AND ${transactions.status} = 'success' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
        totalDeposits: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'deposit' AND ${transactions.status} = 'success' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
        totalWithdrawals: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'withdrawal' AND ${transactions.status} = 'success' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
        totalPending: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'pending' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
      }).from(transactions);

      if (stats.length > 0) {
        emitAdminStatsUpdate({
          totalRevenue: Number(stats[0].totalRevenue) || 0,
          totalDeposits: Number(stats[0].totalDeposits) || 0,
          totalWithdrawals: Number(stats[0].totalWithdrawals) || 0,
          totalPending: Number(stats[0].totalPending) || 0,
        });
      }
    } catch (err: any) {
      console.error("[Wallet Pay Socket Event Error]:", err.message);
    }

    res.json({ success: true, message: "Tickets purchased successfully via wallet!" });
  } catch (error: any) {
    console.error("Wallet Pay Error:", error.message);
    res.status(400).json({ success: false, message: error.message || "Payment failed" });
  }
};

// ✅ ADJUST USER WALLET (ADMIN)
export const adjustUserWallet = async (req: AuthRequest, res: Response) => {
  const { userId, amount, type, reason, note } = req.body;
  const adminId = req.user?.id;

  if (!adminId) {
    return res.status(401).json({ success: false, message: "Unauthorized admin" });
  }

  if (!userId || !amount || !type || !reason) {
    return res.status(400).json({ success: false, message: "userId, amount, type, and reason are required" });
  }

  const normalizedType = type.toLowerCase();
  if (normalizedType !== "add" && normalizedType !== "deduct") {
    return res.status(400).json({ success: false, message: "Type must be 'add' or 'deduct'" });
  }

  if (Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: "Amount must be a positive number" });
  }

  try {
    const updatedWallet = await db.transaction(async (tx) => {
      // 1. Get user's wallet
      const [userWallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .limit(1);

      if (!userWallet) {
        throw new Error("User wallet not found");
      }

      const balance = Number(userWallet.balance) || 0;
      let newBalance = balance;

      if (normalizedType === "add") {
        newBalance = balance + Number(amount);
      } else {
        newBalance = balance - Number(amount);
        if (newBalance < 0) {
          throw new Error(`Insufficient funds in user wallet. Available: ₹${balance}, Attempted deduction: ₹${amount}`);
        }
      }

      // 2. Update wallet balance
      const [walletRow] = await tx
        .update(wallets)
        .set({
          balance: newBalance.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(wallets.id, userWallet.id))
        .returning();

      // 3. Log into transactions
      const [txnRow] = await tx
        .insert(transactions)
        .values({
          userId,
          walletId: userWallet.id,
          txnRef: `ADJ-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
          amount: Number(amount).toFixed(2),
          type: "manual_adjustment",
          status: "success",
          note: `Manual Admin Adjustment: ${reason}. Note: ${note || ""}`,
        })
        .returning();

      // 4. Log into wallet_adjustments
      await tx
        .insert(walletAdjustments)
        .values({
          walletId: userWallet.id,
          adminId: adminId,
          txnId: txnRow.id,
          type: normalizedType as "add" | "deduct",
          amount: Number(amount).toFixed(2),
          reason: reason,
          note: note || null,
        });

      return walletRow;
    });

    // Socket.io real-time update
    try {
      emitPaymentUpdate(userId, {
        status: "success",
        amount: Number(amount),
        available: Number(updatedWallet.balance),
        note: `Manual Admin Adjustment: ${reason}`
      });

      // Emit new transaction to admin
      const [newTxn] = await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.type, "manual_adjustment"))).orderBy(desc(transactions.createdAt)).limit(1);
      if (newTxn) {
        const typeMapping: Record<string, string> = {
          deposit: "Deposit",
          withdrawal: "Withdrawal",
          ticket_purchase: "TicketPurchase",
          prize_payout: "PrizePayout",
          manual_adjustment: "ManualAdjustment",
        };
        const statusMapping: Record<string, string> = {
          pending: "Pending",
          success: "Success",
          failed: "Failed",
        };
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        emitAdminTransaction({
          id: newTxn.id,
          userName: user?.name || "Unknown User",
          amount: newTxn.amount,
          type: typeMapping[newTxn.type] || newTxn.type,
          status: statusMapping[newTxn.status] || newTxn.status,
          method: "Admin Adjustment",
          datetime: newTxn.createdAt || new Date(),
        });
      }

      // Update admin stats
      const stats = await db.select({
        totalRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'ticket_purchase' AND ${transactions.status} = 'success' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
        totalDeposits: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'deposit' AND ${transactions.status} = 'success' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
        totalWithdrawals: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'withdrawal' AND ${transactions.status} = 'success' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
        totalPending: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'pending' THEN ${transactions.amount}::numeric ELSE 0 END), 0)`,
      }).from(transactions);

      if (stats.length > 0) {
        emitAdminStatsUpdate({
          totalRevenue: Number(stats[0].totalRevenue) || 0,
          totalDeposits: Number(stats[0].totalDeposits) || 0,
          totalWithdrawals: Number(stats[0].totalWithdrawals) || 0,
          totalPending: Number(stats[0].totalPending) || 0,
        });
      }
    } catch (err: any) {
      console.error("[Wallet Adjust Socket Event Error]:", err.message);
    }

    return res.json({
      success: true,
      message: "Wallet adjusted successfully",
      wallet: updatedWallet,
    });
  } catch (error: any) {
    console.error("Wallet Adjustment Error:", error.message);
    return res.status(400).json({ success: false, message: error.message || "Failed to adjust wallet" });
  }
};
