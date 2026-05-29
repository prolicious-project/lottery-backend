import { Request, Response } from "express";
import { db } from "../../db";
import { gameTypes, levelPools, levelEntries, wallets, withdrawals, users, transactions } from "../../db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import crypto from "crypto";
import { sendEmailNotification, sendSMSNotification } from "../../utils/notification.util";
import { updateCompanyWallet } from "../../utils/company-wallet.util";
import { emitPaymentUpdate, emitAdminTransaction, emitAdminStatsUpdate } from "../../utils/socket";

/**
 * Helper to get the current user ID for testing/seamless integration.
 * In a real app, this would come from auth middleware (req.user.id).
 * If missing, falls back to the first user in the database (e.g., Ravi Kumar from seed).
 */

const getUserId = async (providedUserId?: any) => {
  if (providedUserId && providedUserId !== 'undefined' && typeof providedUserId === 'string') return providedUserId;
  const [firstUser] = await db.select().from(users).limit(1);
  return firstUser?.id;
};

const processLevelCompletionPayouts = async (tx: any, poolData: any, payoutUsers?: string[]) => {
  const completedLevel = poolData.pool.level;

  const payUser = async (entry: any, note: string, updateStatusToPaid: boolean) => {
    const payoutAmount = Number(entry.amountPaid) * 2;
    if (payoutUsers) payoutUsers.push(entry.userId);
    const [userWallet] = await tx.select().from(wallets).where(eq(wallets.userId, entry.userId));
    if (userWallet) {
      const newBalance = (Number(userWallet.balance) + payoutAmount).toString();
      await tx.update(wallets).set({ balance: newBalance }).where(eq(wallets.id, userWallet.id));

      if (updateStatusToPaid) {
        await tx.update(levelEntries)
          .set({ status: 'paid' })
          .where(eq(levelEntries.id, entry.id));
      }

      const txnRef = `PAYOUT-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

      await tx.insert(transactions).values({
        userId: entry.userId,
        walletId: userWallet.id,
        txnRef,
        amount: payoutAmount.toString(),
        type: "prize_payout",
        status: "success",
        note: note,
      });

      // ── COMPANY WALLET: Prize payout debit (inside same tx) ────────────
      // FLOW: Prize Payout → Company Wallet -= prize; Winner Wallet += prize
      await updateCompanyWallet(
        payoutAmount,
        "prize_payout_debit",
        `Prize payout to user ${entry.userId}: ${note}`,
        txnRef,
        tx
      );

      const [userObj] = await tx.select().from(users).where(eq(users.id, entry.userId));
      if (userObj) {
        if (userObj.email) {
          await sendEmailNotification(
            userObj.email,
            "Payout Received! 🎊",
            `<p>Congratulations ${userObj.name}!</p><p>You have received a payout of <b>₹${payoutAmount}</b>. ${note}</p>`
          );
        }
        if (userObj.phone) {
          await sendSMSNotification(
            userObj.phone,
            `Congratulations ${userObj.name}! You received a payout of ₹${payoutAmount}. Check your wallet.`
          );
        }
      }
    }
  };

  // 1. Standard Payout: Level n completes -> Pay participants in Level n-1
  const prevLevel = completedLevel - 1;
  if (prevLevel >= 0) {
    const prevEntries = await tx.select()
      .from(levelEntries)
      .where(
        and(
          eq(levelEntries.gameTypeId, poolData.game.id),
          eq(levelEntries.level, prevLevel),
          eq(levelEntries.status, 'active')
        )
      );

    for (const entry of prevEntries) {
      await payUser(entry, `Level Game Payout: Level ${prevLevel} Completed`, true);
    }
  }

  // 2. Incremental Payouts (Levels 5 through 11)
  if (completedLevel >= 6 && completedLevel <= 11) {
    for (let l = 5; l <= completedLevel - 2; l++) {
      const entries = await tx.select()
        .from(levelEntries)
        .where(
          and(
            eq(levelEntries.gameTypeId, poolData.game.id),
            eq(levelEntries.level, l)
          )
        );

      for (const entry of entries) {
        const incNote = `Incremental Reward: Level ${l} participant paid for Level ${completedLevel} completion`;
        const [existingTx] = await tx.select().from(transactions).where(
          and(
            eq(transactions.userId, entry.userId),
            eq(transactions.note, incNote)
          )
        ).limit(1);

        if (!existingTx) {
          await payUser(entry, incNote, false);
        }
      }
    }
  }
};

/* ================= USER ENDPOINTS ================= */

// GET /api/level-games
export const getLevelGames = async (req: Request, res: Response) => {
  try {
    const games = await db.select()
      .from(gameTypes)
      .where(and(eq(gameTypes.type, 'level'), eq(gameTypes.isActive, true)));
    res.json(games);
  } catch (error) {
    console.error("Error fetching level games:", error);
    res.status(500).json({ error: "Failed to fetch level games" });
  }
};

// GET /api/levels?levelGameId={id}
export const getActiveLevels = async (req: Request, res: Response) => {
  try {
    const { levelGameId } = req.query;
    if (!levelGameId) return res.status(400).json({ error: "levelGameId is required" });

    const pools = await db.select({
      id: levelPools.id,
      level: levelPools.level,
      currentUsers: levelPools.currentCount,
      requiredUsers: levelPools.requiredCount,
      status: levelPools.status,
      gameName: gameTypes.name,
      entryFee: gameTypes.entryFee,
      commissionRate: gameTypes.commissionRate
    })
      .from(levelPools)
      .innerJoin(gameTypes, eq(levelPools.gameTypeId, gameTypes.id))
      .where(eq(levelPools.gameTypeId, Number(levelGameId)))
      .orderBy(desc(levelPools.id));

    const formattedPools = pools.map(p => {
      // Calculate entry fee based on fee model
      let entryFee = Number(p.entryFee);
      // Ensure we treat p.feeModel carefully, defaulting to fixed if not present
      if ((p as any).feeModel === 'variable') {
        entryFee = entryFee * Math.max(1, p.level);
      }

      return {
        ...p,
        entryFee: entryFee.toString(),
        reward: entryFee * 2
      };
    });

    res.json(formattedPools);
  } catch (error) {
    console.error("Error fetching active levels:", error);
    res.status(500).json({ error: "Failed to fetch active levels" });
  }
};

// POST /api/levels/join
export const joinLevel = async (req: Request, res: Response) => {
  let entryFee = 0;
  const payoutUsers: string[] = [];
  try {
    const { poolId } = req.body;

    // Authenticated user extraction via `protect` middleware
    const user = (req as any).user;
    let userId = user?.id;

    // Fallback solely to support tests directly hitting controller
    if (!userId) {
      userId = await getUserId(req.body.userId);
    }

    if (!poolId || !userId) return res.status(400).json({ error: "Could not identify user or pool" });

    await db.transaction(async (tx) => {
      let actualPoolId = poolId;

      if (typeof poolId === 'string' && poolId.startsWith('placeholder-')) {
        const parts = poolId.split('-');
        if (parts.length < 3) {
          throw new Error("Invalid placeholder format.");
        }
        const gameId = parseInt(parts[1], 10);
        const levelNum = parseInt(parts[2], 10);

        if (isNaN(gameId) || isNaN(levelNum)) {
          throw new Error("Invalid gameId or levelNum in placeholder.");
        }

        const [existingPool] = await tx.select()
          .from(levelPools)
          .where(
            and(
              eq(levelPools.gameTypeId, gameId),
              eq(levelPools.level, levelNum)
            )
          )
          .limit(1);

        if (existingPool) {
          actualPoolId = existingPool.id;
        } else {
          const [game] = await tx.select().from(gameTypes).where(eq(gameTypes.id, gameId));
          if (!game) {
            throw new Error("Game not found.");
          }

          const [newPool] = await tx.insert(levelPools).values({
            gameTypeId: gameId,
            level: levelNum,
            requiredCount: 4,
            currentCount: 0,
            status: 'filling'
          }).returning({ id: levelPools.id });

          actualPoolId = newPool.id;
        }
      } else {
        // Basic UUID format check to avoid DB query failure
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (typeof poolId === 'string' && !uuidRegex.test(poolId)) {
          throw new Error("Invalid Pool ID format.");
        }
      }

      const [pool] = await tx.select({
        pool: levelPools,
        game: gameTypes
      })
        .from(levelPools)
        .innerJoin(gameTypes, eq(levelPools.gameTypeId, gameTypes.id))
        .where(eq(levelPools.id, actualPoolId));

      if (!pool || pool.pool.status !== 'filling' || pool.pool.isClosed) {
        throw new Error("Pool is not available for joining");
      }

      // Check for One Entry Per User Per Level constraint
      const [existingEntry] = await tx.select()
        .from(levelEntries)
        .where(
          and(
            eq(levelEntries.userId, userId),
            eq(levelEntries.gameTypeId, pool.game.id),
            eq(levelEntries.level, pool.pool.level),
            eq(levelEntries.status, 'active') // Or whatever defines a valid paid entry
          )
        )
        .limit(1);

      if (existingEntry) {
        throw new Error("User can join a specific level only once");
      }

      // Calculate entry fee
      entryFee = Number(pool.game.entryFee);
      if (pool.game.feeModel === 'variable') {
        entryFee = entryFee * Math.max(1, pool.pool.level);
      }

      const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId));
      if (!wallet || Number(wallet.balance) < entryFee) {
        throw new Error("Insufficient wallet balance");
      }

      const newBalance = (Number(wallet.balance) - entryFee).toString();
      await tx.update(wallets).set({ balance: newBalance }).where(eq(wallets.id, wallet.id));

      const txnRef = `LVL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
      await tx.insert(transactions).values({
        userId,
        walletId: wallet.id,
        txnRef,
        amount: entryFee.toString(),
        type: "ticket_purchase",
        status: "success",
        note: `Level Join: Pool ${pool.pool.id} (Level ${pool.pool.level})`,
      });

      // ── COMPANY WALLET: Level entry credit (runs inside same tx) ──
      // FLOW: User Wallet -> Company Wallet
      await updateCompanyWallet(
        entryFee,
        "deposit_credit",
        `Level Join: User ${userId} joined pool ${pool.pool.id} (Level ${pool.pool.level})`,
        txnRef,
        tx
      );

      await tx.insert(levelEntries).values({
        userId,
        gameTypeId: pool.game.id,
        poolId: pool.pool.id,
        level: pool.pool.level,
        amountPaid: entryFee.toString(),
        status: 'active'
      });

      const newCount = pool.pool.currentCount + 1;
      await tx.update(levelPools).set({ currentCount: newCount }).where(eq(levelPools.id, pool.pool.id));

      if (newCount >= pool.pool.requiredCount) {
        await tx.update(levelPools)
          .set({
            status: 'completed',
            isClosed: true,
            completedAt: new Date()
          })
          .where(eq(levelPools.id, pool.pool.id));

        // Process payouts using the helper
        await processLevelCompletionPayouts(tx, pool, payoutUsers);
      }
    });

    // Socket.io real-time update for joiner
    try {
      const [updatedWallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
      if (updatedWallet) {
        emitPaymentUpdate(userId, {
          status: "success",
          amount: entryFee,
          available: Number(updatedWallet.balance),
          note: `Level Join: Pool ${poolId} (Level)`
        });
      }

      // Socket.io real-time updates for payout users
      for (const pUserId of payoutUsers) {
        const [pWallet] = await db.select().from(wallets).where(eq(wallets.userId, pUserId)).limit(1);
        if (pWallet) {
          emitPaymentUpdate(pUserId, {
            status: "success",
            amount: entryFee * 2, // payouts are entryFee * 2
            available: Number(pWallet.balance),
            note: "Level Game Payout"
          });
        }
      }

      // Emit live transaction and stats to admins
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

      // Emit updated stats to admins
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
      console.error("[Join Level Socket Event Error]:", err.message);
    }

    res.json({ success: true, message: "Joined pool successfully" });
  } catch (error: any) {
    console.error("Join level error:", error.message);
    res.status(400).json({ error: error.message });
  }
};

// GET /api/levels/my-entries
export const getMyEntries = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    let userId = user?.id;

    if (!userId) {
      userId = await getUserId(req.query.userId);
    }

    if (!userId) return res.status(400).json({ error: "Could not identify user" });

    const entries = await db.select({
      id: levelEntries.id,
      level: levelEntries.level,
      amount: levelEntries.amountPaid,
      createdAt: levelEntries.createdAt,
      status: levelEntries.status,
      gameName: gameTypes.name,
      gameId: gameTypes.id
    })
      .from(levelEntries)
      .innerJoin(gameTypes, eq(levelEntries.gameTypeId, gameTypes.id))
      .where(eq(levelEntries.userId, userId))
      .orderBy(desc(levelEntries.createdAt));

    res.json(entries);
  } catch (error) {
    console.error("Error fetching my entries:", error);
    res.status(500).json({ error: "Failed to fetch entries" });
  }
};

// GET /api/wallet
export const getWallet = async (req: Request, res: Response) => {
  try {
    const userId = await getUserId(req.query.userId);
    if (!userId) return res.status(400).json({ error: "Could not identify user" });

    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId));
    if (!wallet) return res.status(404).json({ error: "Wallet not found" });

    res.json({
      available: Number(wallet.balance),
      locked: Number(wallet.lockedAmount)
    });
  } catch (error) {
    console.error("Error fetching wallet:", error);
    res.status(500).json({ error: "Failed to fetch wallet" });
  }
};

// POST /api/withdraw
export const withdraw = async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;
    const userId = await getUserId(req.body.userId);
    if (!userId || !amount) return res.status(400).json({ error: "User identification or amount missing" });

    await db.transaction(async (tx) => {
      const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, userId));
      if (!wallet || Number(wallet.balance) < Number(amount)) {
        throw new Error("Insufficient balance for withdrawal");
      }

      const newBalance = (Number(wallet.balance) - Number(amount)).toString();
      await tx.update(wallets).set({ balance: newBalance }).where(eq(wallets.id, wallet.id));

      await tx.insert(withdrawals).values({
        userId,
        amount: amount.toString(),
        status: 'pending'
      });
    });

    // Socket.io real-time update
    try {
      const [updatedWallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
      if (updatedWallet) {
        emitPaymentUpdate(userId, {
          status: "pending",
          amount: Number(amount),
          available: Number(updatedWallet.balance),
          note: "Withdrawal request submitted"
        });
      }

      // Emit updated stats (pending amount changes)
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
      console.error("[Withdraw Socket Event Error]:", err.message);
    }

    res.json({ success: true, message: "Withdrawal request submitted" });
  } catch (error: any) {
    console.error("Withdraw error:", error.message);
    res.status(400).json({ error: error.message });
  }
};

/* ================= ADMIN ENDPOINTS ================= */

// GET /api/admin/level-games
export const getAdminLevelGames = async (req: Request, res: Response) => {
  try {
    const games = await db.select().from(gameTypes).where(eq(gameTypes.type, 'level'));
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch admin level games" });
  }
};

// POST /api/admin/level-games
export const createLevelGame = async (req: Request, res: Response) => {
  try {
    const { name, entryFee, description, icon } = req.body;

    const [newGame] = await db.insert(gameTypes).values({
      name,
      entryFee: entryFee.toString(),
      description: description || "Level-based game",
      icon: icon || "🎮",
      type: 'level',
      feeModel: req.body.feeModel || 'fixed',
      isActive: true
    }).returning();

    await db.insert(levelPools).values({
      gameTypeId: newGame.id,
      level: 0,
      requiredCount: 4,
      status: 'filling'
    });

    res.json({ success: true, game: newGame });
  } catch (error: any) {
    console.error("Error creating game:", error);
    res.status(400).json({ error: error.message });
  }
};

// GET /api/admin/level-games/stats
export const getAdminStats = async (req: Request, res: Response) => {
  try {
    const totalGamesCount = await db.select({ count: sql`count(*)` }).from(gameTypes).where(eq(gameTypes.type, 'level'));
    const activePoolsCount = await db.select({ count: sql`count(*)` }).from(levelPools).where(eq(levelPools.status, 'filling'));
    const totalEntriesCount = await db.select({ count: sql`count(*)` }).from(levelEntries);
    const totalPayoutsResult = await db.select({ total: sql`sum(amount)` }).from(withdrawals).where(eq(withdrawals.status, 'success'));

    res.json({
      totalGames: Number(totalGamesCount[0].count),
      activePools: Number(activePoolsCount[0].count),
      totalUsers: Number(totalEntriesCount[0].count),
      totalPayouts: Number(totalPayoutsResult[0].total || 0)
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
};

// GET /api/admin/levels
export const getAdminLevels = async (req: Request, res: Response) => {
  try {
    const { levelGameId } = req.query;

    let query = db.select({
      id: levelPools.id,
      level: levelPools.level,
      gameName: gameTypes.name,
      currentUsers: levelPools.currentCount,
      requiredUsers: levelPools.requiredCount,
      status: levelPools.status,
      entryFee: gameTypes.entryFee,
      commissionRate: gameTypes.commissionRate
    })
      .from(levelPools)
      .innerJoin(gameTypes, eq(levelPools.gameTypeId, gameTypes.id));

    if (levelGameId && levelGameId !== 'All') {
      query = query.where(eq(levelPools.gameTypeId, Number(levelGameId))) as any;
    }

    const pools = await query;

    const formatted = pools.map(p => ({
      ...p,
      // NEW LOGIC: Administrative view also reflects the fixed reward (double the registration fee).
      reward: Number(p.entryFee) * 2
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch admin levels" });
  }
};

// POST /api/admin/levels
// Manually initialize a new level pool for a game
export const createAdminLevel = async (req: Request, res: Response) => {
  try {
    const { gameTypeId, level, requiredCount } = req.body;

    const [result] = await db.insert(levelPools).values({
      gameTypeId: Number(gameTypeId),
      level: Number(level),
      requiredCount: 4,
      currentCount: 0,
      status: 'filling'
    }).returning();

    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Create Level Error:", error);
    res.status(500).json({ error: "Could not create level" });
  }
};

// POST /api/admin/levels/force-complete
export const forceCompletePool = async (req: Request, res: Response) => {
  try {
    const { poolId } = req.body;

    await db.transaction(async (tx) => {
      const [poolData] = await tx.select({
        pool: levelPools,
        game: gameTypes
      })
        .from(levelPools)
        .innerJoin(gameTypes, eq(levelPools.gameTypeId, gameTypes.id))
        .where(eq(levelPools.id, poolId));

      if (!poolData) throw new Error("Pool not found");

      await tx.update(levelPools)
        .set({
          status: 'completed',
          isClosed: true,
          completedAt: new Date()
        })
        .where(eq(levelPools.id, poolId));

      // Process payouts using the helper
      await processLevelCompletionPayouts(tx, poolData);
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to force complete pool" });
  }
};
