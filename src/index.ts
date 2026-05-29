import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { createServer } from "http";
import { initSocket } from "./utils/socket";

// Swagger
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

// Routes
import drawRoutes from "./api/routes/draw.routes";
import paymentRoutes from "./api/routes/payment.routes";
import authRoutes from "./api/routes/auth.routes";
import userRoutes from "./api/routes/user.routes";
import adminRoutes from "./api/routes/admin.route";
import revenueRoutes from "./api/routes/revenue.routes";
import referralRoutes from "./api/routes/referral.routes";
import ticketRoutes from "./api/routes/ticket.routes";
import levelRoutes from "./api/routes/level.routes";
import walletRoutes from "./api/routes/wallet.routes";
import companyWalletRoutes from "./api/routes/company-wallet.routes";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);
// ✅ Parse JSON globally, but crucially preserve the raw unparsed Buffer as 'req.rawBody'.
// This completely guarantees Razorpay Webhook Signatures mathematically match!
app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(cookieParser());   // ✅ IMPORTANT FIX

// Swagger
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Lottery Backend API",
      version: "1.0.0",
      description: "API Documentation for the Lottery Backend",
    },
    servers: [
      {
        url: "http://localhost:10000",
      },
    ],
  },
  apis: ["./src/api/routes/*.ts", "./src/api/controllers/*.ts"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));


app.get("/", (req, res) => {
  res.send("API is running 🚀");
});


// ✅ ROUTES (ORDER IMPORTANT)

app.use("/api/users", userRoutes);
app.use("/api/revenue", revenueRoutes);

app.use("/api", drawRoutes);
app.use("/api", levelRoutes);

app.use("/api/payments", paymentRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/referral", referralRoutes);
app.use("/api/tickets", ticketRoutes);

// ✅ WALLET ROUTES
app.use("/api/wallet", walletRoutes);

// ✅ COMPANY WALLET — registered BEFORE /api/admin to prevent route shadowing
app.use("/api/admin/company-wallet", companyWalletRoutes);

// ✅ ADMIN ROUTES
app.use("/api/admin", adminRoutes);

const PORT = process.env.PORT || 10000;

const httpServer = createServer(app);
const io = initSocket(httpServer);
app.set("io", io);

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});