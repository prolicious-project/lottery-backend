import { Router } from "express";

import {
  getUsers,
  getUsersWithCount,
  getUserById
} from "../controllers/user.controller";

const router = Router();

// GET /api/users/count
router.get("/", getUsersWithCount);

// GET /api/users
router.get("/users", getUsers);

// GET Single User
router.get("/:id", getUserById);

export default router;

