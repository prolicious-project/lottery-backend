import express from "express";
import cors from "cors";
import userRoutes from "./src/api/routes/user.routes.ts";

const app = express();


app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000", "https://lottery-frontend-weld.vercel.app"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);
app.use(express.json());

// connect routes
app.use("/api", userRoutes);

app.get("/", (req, res) => {
  res.json({ message: "Server running ✅" });
});

app.listen(10000, () => {
  console.log("🚀 Server started on port 10000");
});