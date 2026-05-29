import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";

let io: Server | null = null;

export const initSocket = (httpServer: HttpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
      methods: ["GET", "POST", "PUT", "DELETE"],
      credentials: true,
    },
  });

  io.on("connection", (socket: Socket) => {
    const userId = socket.handshake.query.userId as string;
    const role = socket.handshake.query.role as string;

    console.log(`🔌 Client connected: ${socket.id} (User: ${userId || "guest"}, Role: ${role || "user"})`);

    if (userId) {
      socket.join(`user_${userId}`);
      console.log(`👤 Socket ${socket.id} joined user_${userId}`);
    }

    if (role === "admin") {
      socket.join("admin");
      console.log(`👑 Socket ${socket.id} joined admin room`);
    }

    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error("Socket.io has not been initialized!");
  }
  return io;
};

/**
 * Reusable utility to emit a real-time payment/wallet update to a specific user.
 */
export const emitPaymentUpdate = (userId: string, data: {
  transactionId?: string;
  status: "success" | "failed" | "pending";
  amount: number;
  available: number;
  note?: string;
}) => {
  if (io) {
    console.log(`📣 Emitting real-time payment update to user_${userId}:`, data);
    io.to(`user_${userId}`).emit("payment_updated", data);
  }
};

/**
 * Reusable utility to broadcast a new transaction to the admin room.
 */
export const emitAdminTransaction = (data: {
  id: string;
  userName: string;
  amount: string;
  type: string;
  status: string;
  method: string;
  datetime: Date | string;
}) => {
  if (io) {
    console.log(`📣 Emitting real-time new transaction to admin room:`, data);
    io.to("admin").emit("new_transaction", data);
  }
};

/**
 * Reusable utility to broadcast updated dashboard stats to the admin room.
 */
export const emitAdminStatsUpdate = (stats: {
  totalRevenue: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalPending: number;
}) => {
  if (io) {
    console.log(`📣 Emitting real-time admin stats update to admin room:`, stats);
    io.to("admin").emit("stats_updated", stats);
  }
};
