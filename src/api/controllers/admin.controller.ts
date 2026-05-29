import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";

import { db } from "../../db/db";
import { admins } from "../../db/schema/core";
import { adminRoles } from "../../db/schema";

import {
  adminLoginSchema,
  createAdminRoleSchema,
  createAdminSchema,
} from "../validators/admin.validator";
import { AuthRequest } from "../middleware/auth.middleware";

export const createAdminRole = async (req: Request, res: Response) => {
  try {
    const validated = createAdminRoleSchema.safeParse(req.body);

    if (!validated.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.error.flatten().fieldErrors,
      });
    }

    const { name, permissions } = validated.data;

    const existingRole = await db
      .select()
      .from(adminRoles)
      .where(eq(adminRoles.name, name));

    if (existingRole.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Admin role already exists",
      });
    }

    const newRole = await db
      .insert(adminRoles)
      .values({
        name,
        permissions,
      })
      .returning();

    return res.status(201).json({
      success: true,
      message: "Admin role created successfully",
      data: newRole[0],
    });
  } catch (error) {
    console.error("Create admin role error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const createAdmin = async (req: Request, res: Response) => {
  try {
    const validated = createAdminSchema.safeParse(req.body);

    if (!validated.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.error.flatten().fieldErrors,
      });
    }

    const { roleId, name, email, password, isActive } = validated.data;

    const role = await db
      .select()
      .from(adminRoles)
      .where(eq(adminRoles.id, roleId));

    if (!role.length) {
      return res.status(404).json({
        success: false,
        message: "Admin role not found",
      });
    }

    const existingAdmin = await db
      .select()
      .from(admins)
      .where(eq(admins.email, email));

    if (existingAdmin.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Admin with this email already exists",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newAdmin = await db
      .insert(admins)
      .values({
        roleId,
        name,
        email,
        passwordHash,
        isActive: isActive ?? true,
      })
      .returning();

    return res.status(201).json({
      success: true,
      message: "Admin created successfully",
      data: {
        id: newAdmin[0].id,
        roleId: newAdmin[0].roleId,
        name: newAdmin[0].name,
        email: newAdmin[0].email,
        isActive: newAdmin[0].isActive,
        createdAt: newAdmin[0].createdAt,
      },
    });
  } catch (error) {
    console.error("Create admin error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const adminLogin = async (req: Request, res: Response) => {
  try {
    console.log("ADMIN LOGIN ATTEMPT 👉", req.body);
    const validated = adminLoginSchema.safeParse(req.body);

    if (!validated.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.error.flatten().fieldErrors,
      });
    }

    const { email, password } = validated.data;

    const adminData = await db
      .select({
        id: admins.id,
        roleId: admins.roleId,
        name: admins.name,
        email: admins.email,
        passwordHash: admins.passwordHash,
        isActive: admins.isActive,
        role: admins.role,        // ✅ enum value: always 'admin'
        roleName: adminRoles.name, // display name e.g. 'Super Admin'
        permissions: adminRoles.permissions,
      })
      .from(admins)
      .innerJoin(adminRoles, eq(admins.roleId, adminRoles.id))
      .where(eq(admins.email, email));

    if (!adminData.length) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }

    const admin = adminData[0];

    const isPasswordValid = await bcrypt.compare(
      password,
      admin.passwordHash
    );

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin credentials",
      });
    }

    // JWT Token
    const token = jwt.sign(
      {
        id: admin.id,
        role: admin.role,         // ✅ always 'admin' — adminOnly middleware checks this
        roleName: admin.roleName, // display name for UI
        permissions: admin.permissions,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: "1d" }
    );

    // ✅ Store cookies
    res.cookie("admin_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 24 * 60 * 60 * 1000,
    });

    // res.cookie("admin_id", admin.id, {
    //   httpOnly: true,
    //   sameSite: "lax",
    //   secure: false,
    // });

    // res.cookie("admin_role", admin.roleName, {
    //   httpOnly: true,
    //   sameSite: "lax",
    //   secure: false,
    // });

    await db
      .update(admins)
      .set({
        lastLoginAt: new Date(),
      })
      .where(eq(admins.id, admin.id));

    return res.status(200).json({
      success: true,
      message: "Admin login successful",
    });

  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getAdminProfile = async (req: AuthRequest, res: Response) => {
  try {
    return res.status(200).json({
      success: true,
      message: "Admin authorized",
      user: req.user,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};