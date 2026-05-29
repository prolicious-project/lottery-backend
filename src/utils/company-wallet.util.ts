import { db } from "../db";
import { companyWallet, companyWalletTransactions } from "../db/schema";
import { eq, sql } from "drizzle-orm";

export type CompanyWalletTxnType =
  | "deposit_credit"     // User deposit verified → Company += amount
  | "prize_payout_debit" // Prize paid to user   → Company -= prize
  | "withdrawal_debit";  // User withdrawal paid  → Company -= amount (optional)

/**
 * Atomically updates the singleton company wallet balance and writes an
 * auditable ledger row to company_wallet_transactions.
 *
 * RULES (from spec):
 *  - deposit_credit     : +amount  (called after Razorpay deposit verified)
 *  - prize_payout_debit : -amount  (called inside level payout logic)
 *  - withdrawal_debit   : -amount  (optional — call if you want to track payouts)
 *
 * @param amount    Always a POSITIVE number. Direction is determined by `type`.
 * @param type      One of the CompanyWalletTxnType literals above.
 * @param note      Human-readable audit note (e.g. "Deposit: Razorpay order_xxx").
 * @param userTxnRef  Optional txnRef from the user-side transaction.
 * @param outerTx   Optional Drizzle tx object. When provided, all operations
 *                  join the caller's transaction instead of opening a new one.
 */
export const updateCompanyWallet = async (
  amount: number,
  type: CompanyWalletTxnType,
  note: string,
  userTxnRef?: string,
  outerTx?: any
): Promise<{ success: boolean; newBalance?: number; error?: string }> => {
  if (amount <= 0) {
    return { success: false, error: "Amount must be a positive number." };
  }

  const isDebit = type === "prize_payout_debit" || type === "withdrawal_debit";
  const delta = isDebit ? -amount : amount;

  const run = async (tx: any) => {
    // ── 1. Get or create the singleton company wallet row ──────────────────
    const existing = await tx
      .select()
      .from(companyWallet)
      .where(eq(companyWallet.slug, "main"))
      .limit(1);

    let wallet = existing[0];

    if (!wallet) {
      // Bootstrap on first use
      const [created] = await tx
        .insert(companyWallet)
        .values({ slug: "main", balance: "0", currency: "INR" })
        .returning();
      wallet = created;
    }

    const currentBalance = Number(wallet.balance);
    const newBalance = currentBalance + delta;

    if (newBalance < 0) {
      console.warn(
        `[CompanyWallet] Balance is negative. Current: ₹${currentBalance}, Requested debit: ₹${amount}, New: ₹${newBalance}`
      );
    }

    // ── 2. Update company wallet balance ───────────────────────────────────
    await tx
      .update(companyWallet)
      .set({
        balance: newBalance.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(companyWallet.slug, "main"));

    // ── 3. Write ledger entry ──────────────────────────────────────────────
    await tx.insert(companyWalletTransactions).values({
      amount: amount.toFixed(2),
      type,
      balanceAfter: newBalance.toFixed(2),
      userTxnRef: userTxnRef ?? null,
      note,
    });

    return newBalance;
  };

  try {
    let newBalance: number;

    if (outerTx) {
      // Participate in caller's existing transaction
      newBalance = await run(outerTx);
    } else {
      // Open a new transaction
      newBalance = await db.transaction(run);
    }

    return { success: true, newBalance };
  } catch (err: any) {
    console.error("[CompanyWallet] Update failed:", err.message);
    return { success: false, error: err.message };
  }
};
