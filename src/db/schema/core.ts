import {
  pgTable, uuid, varchar, text, boolean,
  integer, numeric, timestamp, pgEnum, index
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  levels, countries, gameTypes,
  kycDocumentTypes, notificationTemplates, adminRoles
} from './independent';

// ── Enums ──
export const userStatusEnum = pgEnum('user_status', [
  'active', 'suspended', 'banned', 'pending_verification'
]);

export const kycStatusEnum = pgEnum('kyc_status', [
  'not_submitted', 'pending', 'verified', 'rejected'
]);

export const drawStatusEnum = pgEnum('draw_status', [
  'draft', 'scheduled', 'live', 'completed', 'cancelled'
]);

export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft', 'scheduled', 'sent', 'failed'
]);

export const userRoleEnum = pgEnum('user_role', [
  'admin', 'user'
]);

export const poolStatusEnum = pgEnum('pool_status', [
  'filling',
  'completed',
]);

export const entryStatusEnum = pgEnum('entry_status', [
  'active',
  'paid',
]);

export const withdrawalStatusEnum = pgEnum('withdrawal_status', [
  'pending',
  'success',
  'failed',
]);

// ── 9. users ──
export const users = pgTable('users', {
  id:               uuid('id').primaryKey().defaultRandom(),
  levelId:          integer('level_id').references(() => levels.id).default(1),
  countryId:        integer('country_id').references(() => countries.id),
  name:             varchar('name', { length: 200 }).notNull(),
  email:            varchar('email', { length: 255 }).notNull().unique(),
  phone:            varchar('phone', { length: 20 }).notNull().unique(),
  passwordHash:     varchar('password_hash', { length: 255 }).notNull(),
  avatarUrl:        text('avatar_url'),
  role:             userRoleEnum('role').notNull().default('user'),
  points:           integer('points').notNull().default(0),
  totalPoints:      integer('total_points').notNull().default(0),
  status:           userStatusEnum('status').notNull().default('active'),
  kycStatus:        kycStatusEnum('kyc_status').notNull().default('not_submitted'),
  mfaEnabled:       boolean('mfa_enabled').notNull().default(false),
  mfaSecret:        varchar('mfa_secret', { length: 100 }),
  emailVerified:    boolean('email_verified').notNull().default(false),
  phoneVerified:    boolean('phone_verified').notNull().default(false),
  lastLoginAt:      timestamp('last_login_at'),
  createdAt:        timestamp('created_at').defaultNow(),
  updatedAt:        timestamp('updated_at').defaultNow(),
}, (t) => ({
  emailIdx:  index('users_email_idx').on(t.email),
  phoneIdx:  index('users_phone_idx').on(t.phone),
  levelIdx:  index('users_level_idx').on(t.levelId),
  statusIdx: index('users_status_idx').on(t.status),
}));

// ── 10. admins ──
export const admins = pgTable('admins', {
  id:           uuid('id').primaryKey().defaultRandom(),
  roleId:       integer('role_id').references(() => adminRoles.id).notNull(),
  name:         varchar('name', { length: 200 }).notNull(),
  email:        varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role:             userRoleEnum('role').notNull().default('admin'),
  isActive:     boolean('is_active').notNull().default(true),
  lastLoginAt:  timestamp('last_login_at'),
  createdAt:    timestamp('created_at').defaultNow(),
});

// ── 11. draws ──
export const draws = pgTable('draws', {
  id:              uuid('id').primaryKey().defaultRandom(),
  gameTypeId:      integer('game_type_id').references(() => gameTypes.id).notNull(),
  createdBy:       uuid('created_by').references(() => admins.id),
  name:            varchar('name', { length: 200 }).notNull(),
  prizePool:       numeric('prize_pool', { precision: 15, scale: 2 }).notNull(),
  ticketPrice:     numeric('ticket_price', { precision: 10, scale: 2 }).notNull(),
  maxEntries:      integer('max_entries').notNull(),
  currentEntries:  integer('current_entries').notNull().default(0),
  status:          drawStatusEnum('status').notNull().default('draft'),
  drawDate:        timestamp('draw_date').notNull(),
  drawstartDate: timestamp('draw_start_date').notNull(),
  drawendDate : timestamp('draw_end_date').notNull(),
  description:     text('description'),
  rngSeedHash:     varchar('rng_seed_hash', { length: 124 }),
  isGuaranteed:    boolean('is_guaranteed').notNull().default(true),
  minEntries:      integer('min_entries').default(10),
  createdAt:       timestamp('created_at').defaultNow(),
  updatedAt:       timestamp('updated_at').defaultNow(),
}, (t) => ({
  statusIdx:   index('draws_status_idx').on(t.status),
  drawDateIdx: index('draws_date_idx').on(t.drawDate),
}));
// ── 12. wallets ──
export const wallets = pgTable('wallets', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').references(() => users.id).notNull().unique(),
  balance:       numeric('balance', { precision: 15, scale: 2 }).notNull().default('0'),
  bonusBalance:  numeric('bonus_balance', { precision: 15, scale: 2 }).notNull().default('0'),
  lockedAmount:  numeric('locked_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  currency:      varchar('currency', { length: 5 }).notNull().default('INR'),
  updatedAt:     timestamp('updated_at').defaultNow(),
});

// ── 13. referral_codes ──
export const referralCodes = pgTable('referral_codes', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          uuid('user_id').references(() => users.id).notNull().unique(),
  code:            varchar('code', { length: 20 }).notNull().unique(),
  totalReferrals:  integer('total_referrals').notNull().default(0),
  totalEarned:     numeric('total_earned', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt:       timestamp('created_at').defaultNow(),
}, (t) => ({
  codeIdx: index('referral_codes_code_idx').on(t.code),
}));

// ── 14. kyc_submissions ──
export const kycSubmissions = pgTable('kyc_submissions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').references(() => users.id).notNull(),
  docTypeId:   integer('doc_type_id').references(() => kycDocumentTypes.id).notNull(),
  docNumber:   varchar('doc_number', { length: 100 }),
  frontUrl:    text('front_url').notNull(),
  backUrl:     text('back_url'),
  selfieUrl:   text('selfie_url'),
  status:      kycStatusEnum('status').notNull().default('pending'),
  submittedAt: timestamp('submitted_at').defaultNow(),
  reviewedAt:  timestamp('reviewed_at'),
});

// ── 15. notification_campaigns ──
export const notificationCampaigns = pgTable('notification_campaigns', {
  id:               uuid('id').primaryKey().defaultRandom(),
  adminId:          uuid('admin_id').references(() => admins.id),
  templateId:       integer('template_id').references(() => notificationTemplates.id),
  title:            varchar('title', { length: 200 }).notNull(),
  message:          text('message').notNull(),
  targetAudience:   varchar('target_audience', { length: 100 }),
  targetLevelMin:   integer('target_level_min'),
  scheduledAt:      timestamp('scheduled_at'),
  sentAt:           timestamp('sent_at'),
  totalSent:        integer('total_sent').notNull().default(0),
  totalOpened:      integer('total_opened').notNull().default(0),
  totalClicked:     integer('total_clicked').notNull().default(0),
  status:           campaignStatusEnum('status').notNull().default('draft'),
  createdAt:        timestamp('created_at').defaultNow(),
});


export const levelPools = pgTable('level_pools', {
  id: uuid('id').primaryKey().defaultRandom(),

  gameTypeId: integer('game_type_id')
    .references(() => gameTypes.id)
    .notNull(),

  level: integer('level').notNull(), // 1,2,3...

  requiredCount: integer('required_count').notNull(), // 4,16,64

  currentCount: integer('current_count').notNull().default(0),

  status: poolStatusEnum('status').notNull().default('filling'),

  isClosed: boolean('is_closed').notNull().default(false),
  
  completedAt: timestamp('completed_at'),

  createdAt: timestamp('created_at').defaultNow(),
});

export const levelEntries = pgTable('level_entries', {
  id: uuid('id').primaryKey().defaultRandom(),

  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),

  gameTypeId: integer('game_type_id')
    .references(() => gameTypes.id)
    .notNull(),

  poolId: uuid('pool_id')
    .references(() => levelPools.id)
    .notNull(),

  level: integer('level').notNull(),

  amountPaid: numeric('amount_paid', { precision: 10, scale: 2 }).notNull(),

  status: entryStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const withdrawals = pgTable('withdrawals', {
  id: uuid('id').primaryKey().defaultRandom(),

  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),

  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),

  status: withdrawalStatusEnum('status').notNull().default('pending'),

  upiId: varchar('upi_id', { length: 100 }),

  createdAt: timestamp('created_at').defaultNow(),
});

