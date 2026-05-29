import {
  pgTable, serial, uuid, varchar, boolean,
  text, integer, jsonb, timestamp, pgEnum, numeric
} from 'drizzle-orm/pg-core';


export const gameTypeEnum = pgEnum('game_type_enum', [
  'lottery',
  'level',
]);

// ── 1. levels ──
export const levels = pgTable('levels', {
  id: serial('id').primaryKey(),
  levelNum: integer('level_num').notNull().unique(),
  name: varchar('name', { length: 50 }).notNull(),
  color: varchar('color', { length: 20 }).notNull(),
  pointsMin: integer('points_min').notNull(),
  pointsMax: integer('points_max'),
  discountPct: integer('discount_pct').notNull().default(0),
  picksCount: integer('picks_count').notNull().default(1),
  perks: jsonb('perks').$type<string[]>().default([]),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── 2. game_types ──
export const gameTypes = pgTable('game_types', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  icon: varchar('icon', { length: 10 }),
  isActive: boolean('is_active').notNull().default(true),
  entryFee: numeric('entry_fee', { precision: 10, scale: 2 }).notNull().default('0'),
  commissionRate: numeric('commission_rate', { precision: 5, scale: 2 }).notNull().default('0.10'), // Default 10%
  feeModel: varchar('fee_model', { length: 20 }).notNull().default('fixed'), // 'fixed' or 'variable'
  createdAt: timestamp('created_at').defaultNow(),
  type: gameTypeEnum('type').notNull(),
});

// ── 3. payment_methods ── 
export const paymentMethods = pgTable('payment_methods', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  icon: varchar('icon', { length: 10 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── 4. kyc_document_types ──
export const kycDocumentTypes = pgTable('kyc_document_types', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  countriesAccepted: jsonb('countries_accepted').$type<string[]>().default([]),
  isActive: boolean('is_active').notNull().default(true),
});

// ── 5. notification_templates ──
export const notificationTemplates = pgTable('notification_templates', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 200 }).notNull(),
  message: text('message').notNull(),
  icon: varchar('icon', { length: 10 }),
  type: varchar('type', { length: 50 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── 6. rejection_reasons ──
export const rejectionReasons = pgTable('rejection_reasons', {
  id: serial('id').primaryKey(),
  reason: varchar('reason', { length: 200 }).notNull(),
  description: text('description'),
});

// ── 7. countries ──
export const countries = pgTable('countries', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 5 }).notNull().unique(),
  currency: varchar('currency', { length: 10 }),
  isActive: boolean('is_active').notNull().default(true),
});

// ── 8. admin_roles ──
export const adminRoles = pgTable('admin_roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  permissions: jsonb('permissions').$type<string[]>().default([]),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Company Wallet Enums ──
export const companyWalletTxnTypeEnum = pgEnum('company_wallet_txn_type', [
  'deposit_credit',      // User deposits → Company Wallet += amount
  'prize_payout_debit',  // Prize paid to winner → Company Wallet -= prize
  'withdrawal_debit',    // Admin processes user withdrawal → Company Wallet -= amount (optional)
]);

// ── 9. company_wallet ──
// Singleton row — always use slug='main' to upsert / select.
// Do NOT insert more than one row; enforce at the application layer.
export const companyWallet = pgTable('company_wallet', {
  id:        uuid('id').primaryKey().defaultRandom(),
  slug:      varchar('slug', { length: 20 }).notNull().unique().default('main'),
  balance:   numeric('balance', { precision: 18, scale: 2 }).notNull().default('0'),
  currency:  varchar('currency', { length: 5 }).notNull().default('INR'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ── 10. company_wallet_transactions ──
// Full ledger for every movement in/out of the company wallet.
export const companyWalletTransactions = pgTable('company_wallet_transactions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  /** Amount is always stored positive; direction is encoded in type */
  amount:          numeric('amount', { precision: 15, scale: 2 }).notNull(),
  type:            companyWalletTxnTypeEnum('type').notNull(),
  /** Running company balance AFTER this transaction */
  balanceAfter:    numeric('balance_after', { precision: 18, scale: 2 }).notNull(),
  /** Reference to the user transaction that triggered this (optional) */
  userTxnRef:      varchar('user_txn_ref', { length: 100 }),
  /** Free-text description for audit trail */
  note:            text('note'),
  createdAt:       timestamp('created_at').defaultNow(),
});