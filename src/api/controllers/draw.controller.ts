import { Request, Response } from "express";
import { db } from "../../db/index";
import { draws, gameTypes, tickets, drawResults, drawWinners, wallets, users, transactions } from "../../db/schema";
import { eq, desc, inArray, and, sql } from "drizzle-orm";
import { drawStatusEnum } from "../../db/schema";
import { sendEmailNotification } from "../../utils/notification.util";
import { emitPaymentUpdate, emitAdminTransaction, emitAdminStatsUpdate } from "../../utils/socket";

/**
 * @swagger
 * /api/create-draw:
 *   post:
 *     summary: Create a new draw
 *     description: Endpoint to create a new lottery draw
 *     tags:
 *       - Draws
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - game_type_id
 *               - created_by
 *               - name
 *               - prize_pool
 *               - ticket_price
 *               - max_entries
 *               - status
 *               - draw_date
 *               - draw_start_date
 *               - draw_end_date
 *               - rng_seed_hash
 *               - is_guaranteed
 *               - min_entries
 *             properties:
 *               game_type_id:
 *                 type: integer
 *               created_by:
 *                 type: string
 *                 format: uuid
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               prize_pool:
 *                 type: number
 *               ticket_price:
 *                 type: number
 *               max_entries:
 *                 type: integer
 *               status:
 *                 type: string
 *               draw_date:
 *                 type: string
 *                 format: date-time
 *               draw_start_date:
 *                 type: string
 *                 format: date-time
 *               draw_end_date:
 *                 type: string
 *                 format: date-time
 *               rng_seed_hash:
 *                 type: string
 *               is_guaranteed:
 *                 type: boolean
 *               min_entries:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Draw created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Invalid input or date format
 *       500:
 *         description: Internal server error
 */
export const createDraw = async (req: Request, res: Response) => {
  try {

    console.log("Request body:", req.body);

    const {
      game_type_id,
      created_by,
      name,
      prize_pool,
      ticket_price,
      max_entries,
      status,
      draw_date,
      draw_start_date,
      draw_end_date,
      description,
      rng_seed_hash,
      is_guaranteed,
      min_entries
    } = req.body;

    // Convert string → Date
    const drawDate = new Date(draw_date);
    const drawStartDate = new Date(draw_start_date);
    const drawEndDate = new Date(draw_end_date);

    // Validate dates
    if (
      isNaN(drawDate.getTime()) ||
      isNaN(drawStartDate.getTime()) ||
      isNaN(drawEndDate.getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format"
      });
    }

    const newDraw = await db
      .insert(draws)
      .values({
        gameTypeId: game_type_id,
        createdBy: created_by,
        name,
        prizePool: prize_pool,
        ticketPrice: ticket_price,
        maxEntries: max_entries,
        status,

        drawDate: drawDate,
        drawstartDate: drawStartDate,
        drawendDate: drawEndDate,

        description,
        rngSeedHash: rng_seed_hash,
        isGuaranteed: is_guaranteed,
        minEntries: min_entries
      })
      .returning();

    res.status(201).json({
      success: true,
      data: newDraw
    });

  } catch (error)
  {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to create draw"
    });

  }

};

/**
 * @swagger
 * /api/draws:
 *   get:
 *     summary: Get all draws
 *     description: Returns a paginated list of all lottery draws with their game type details. Supports optional filtering by draw status.
 *     tags:
 *       - Draws
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, scheduled, live, completed, cancelled]
 *         description: Filter draws by status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of draws per page
 *     responses:
 *       200:
 *         description: Draws fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Draw'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       500:
 *         description: Server error
 */
export const getAllDraws = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const offset = (page - 1) * limit;
    const statusFilter = req.query.status as string | undefined;

    // Validate status if provided
    const validStatuses = ["draft", "scheduled", "live", "completed", "cancelled"];
    if (statusFilter && !validStatuses.includes(statusFilter)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`
      });
    }

    // Build base query
    const baseQuery = db
      .select({
        id:             draws.id,
        name:           draws.name,
        status:         draws.status,
        prizePool:      draws.prizePool,
        ticketPrice:    draws.ticketPrice,
        maxEntries:     draws.maxEntries,
        currentEntries: draws.currentEntries,
        minEntries:     draws.minEntries,
        drawDate:       draws.drawDate,
        drawStartDate:  draws.drawstartDate,
        drawEndDate:    draws.drawendDate,
        description:    draws.description,
        isGuaranteed:   draws.isGuaranteed,
        rngSeedHash:    draws.rngSeedHash,
        createdAt:      draws.createdAt,
        updatedAt:      draws.updatedAt,
        gameTypeId:     draws.gameTypeId,
        gameTypeName:   gameTypes.name,
        gameTypeIcon:   gameTypes.icon,
      })
      .from(draws)
      .leftJoin(gameTypes, eq(draws.gameTypeId, gameTypes.id))
      .orderBy(desc(draws.createdAt));

    // Apply status filter if provided
    const filteredQuery = statusFilter
      ? baseQuery.where(eq(draws.status, statusFilter as typeof drawStatusEnum.enumValues[number]))
      : baseQuery;

    // Fetch data with pagination
    const allDraws = await filteredQuery.limit(limit).offset(offset);

    // Get total count
    const countResult = await db
      .select({ id: draws.id })
      .from(draws)
      .where(statusFilter ? eq(draws.status, statusFilter as typeof drawStatusEnum.enumValues[number]) : undefined);

    const total = countResult.length;
    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      data: allDraws,
      pagination: {
        total,
        page,
        limit,
        totalPages
      }
    });

  } catch (error) {
    console.error("CRITICAL: getAllDraws failed. Detailed error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching draws",
      error: process.env.NODE_ENV === "development" ? (error as Error).message : undefined
    });
  }
};

export const getDrawTickets = async (req: Request, res: Response) => {
  try {
    const drawId = req.params.id as string;
    const allTickets = await db.select({
      ticketNumber: tickets.ticketNumber,
      pickedNumbers: tickets.pickedNumbers,
    }).from(tickets).where(eq(tickets.drawId, drawId));

    const bookedBoxes = allTickets.map(t => t.ticketNumber);

    res.status(200).json({
      success: true,
      data: bookedBoxes,
      pickedNumbers: allTickets.map(t => t.pickedNumbers).filter(Boolean)
    });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ success: false, message: "Error fetching tickets" });
  }
};

// POST /api/draw-results — Admin declares result by selecting winning ticket numbers
export const declareResult = async (req: Request, res: Response) => {
  const { drawId, winningTicketNumbers } = req.body;

  if (!drawId || !Array.isArray(winningTicketNumbers) || winningTicketNumbers.length === 0) {
    return res.status(400).json({ success: false, error: "drawId and winningTicketNumbers[] are required" });
  }

  try {
    const winnersToEmit: { userId: string; prize: number }[] = [];
    await db.transaction(async (tx) => {
      // 1. Fetch draw and guard against double-declaration
      const [draw] = await tx.select().from(draws).where(eq(draws.id, drawId)).limit(1);
      if (!draw) throw new Error("Draw not found");
      if (draw.status === "completed") throw new Error("Result already declared for this draw");

      // 2. Look up winning tickets
      const winningTickets = await tx
        .select()
        .from(tickets)
        .where(and(eq(tickets.drawId, drawId), inArray(tickets.ticketNumber, winningTicketNumbers)));

      const winnersCount = winningTickets.length;
      const prizePool = Number(draw.prizePool);
      const prizePerWinner = winnersCount > 0 ? (prizePool / winnersCount).toFixed(2) : "0.00";
      const displayNumbers = winningTickets.length > 0
        ? winningTickets.map((t) => t.pickedNumbers || t.ticketNumber).filter(Boolean).join(",")
        : winningTicketNumbers.join(",");


      // 3. Mark draw as completed
      await tx.update(draws).set({ status: "completed" }).where(eq(draws.id, drawId));

      // 4. Insert draw_results summary
      await tx.insert(drawResults).values({
        drawId,
        winningNumbers: displayNumbers,
        totalTicketsSold: draw.currentEntries ?? 0,
        totalPrizePaid: winnersCount > 0 ? prizePool.toString() : "0.00",
        winnersCount,
        resultDeclaredAt: new Date(),
      });

      // 5. For each winner: mark ticket, record draw_winner, credit wallet
      for (const t of winningTickets) {
        await tx.update(tickets).set({ isWinner: true }).where(eq(tickets.id, t.id));

        await tx.insert(drawWinners).values({
          drawId,
          userId: t.userId,
          prizeAmount: prizePerWinner,
          createdAt: new Date(),
        });

        await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance}::numeric + ${prizePerWinner}::numeric` })
          .where(eq(wallets.userId, t.userId));

        winnersToEmit.push({ userId: t.userId, prize: Number(prizePerWinner) });

        const [userObj] = await tx.select().from(users).where(eq(users.id, t.userId));
        if (userObj && userObj.email) {
          await sendEmailNotification(
            userObj.email,
            "Congratulations! You Won the Draw! 🎉",
            `<p>Hi ${userObj.name},</p><p>You won <b>₹${prizePerWinner}</b> in the latest draw. The payout has been credited to your wallet.</p>`
          );
        }
      }
    });

    // Socket.io real-time update
    try {
      for (const winner of winnersToEmit) {
        const [updatedWallet] = await db.select().from(wallets).where(eq(wallets.userId, winner.userId)).limit(1);
        if (updatedWallet) {
          emitPaymentUpdate(winner.userId, {
            status: "success",
            amount: winner.prize,
            available: Number(updatedWallet.balance),
            note: "Draw Payout Winner"
          });
        }
      }

      // Emit new transactions for payouts to admins
      for (const winner of winnersToEmit) {
        const [newTxn] = await db.select().from(transactions).where(and(eq(transactions.userId, winner.userId), eq(transactions.type, "prize_payout"))).orderBy(desc(transactions.createdAt)).limit(1);
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
          const [user] = await db.select().from(users).where(eq(users.id, winner.userId)).limit(1);
          emitAdminTransaction({
            id: newTxn.id,
            userName: user?.name || "Unknown User",
            amount: newTxn.amount,
            type: typeMapping[newTxn.type] || newTxn.type,
            status: statusMapping[newTxn.status] || newTxn.status,
            method: "Prize",
            datetime: newTxn.createdAt || new Date(),
          });
        }
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
      console.error("[Declare Result Socket Event Error]:", err.message);
    }

    return res.status(200).json({ success: true, message: "Result declared and winners rewarded" });
  } catch (error: any) {
    console.error("[declareResult]", error.message);
    return res.status(400).json({ success: false, error: error.message });
  }
};

// GET /api/draw-results — Public: fetch all completed draw results
export const getDrawResults = async (_req: Request, res: Response) => {
  try {
    const results = await db
      .select({
        id: drawResults.id,
        drawId: draws.id,
        drawName: draws.name,
        prizePool: draws.prizePool,
        drawDate: draws.drawDate,
        gameTypeName: gameTypes.name,
        gameTypeIcon: gameTypes.icon,
        winningNumbers: drawResults.winningNumbers,
        totalTicketsSold: drawResults.totalTicketsSold,
        totalPrizePaid: drawResults.totalPrizePaid,
        winnersCount: drawResults.winnersCount,
        resultDeclaredAt: drawResults.resultDeclaredAt,
      })
      .from(drawResults)
      .innerJoin(draws, eq(drawResults.drawId, draws.id))
      .leftJoin(gameTypes, eq(draws.gameTypeId, gameTypes.id))
      .orderBy(desc(drawResults.resultDeclaredAt));

    return res.status(200).json({ success: true, data: results });
  } catch (error: any) {
    console.error("[getDrawResults]", error.message);
    return res.status(500).json({ success: false, error: "Failed to fetch draw results" });
  }
};