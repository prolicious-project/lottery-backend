import { db } from '../src/db';
import { users, wallets, transactions } from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function testInsert() {
  try {
    console.log("Checking if users exist...");
    const allUsers = await db.select().from(users).limit(5);
    console.log("Users in DB:", allUsers.map(u => u.id));

    console.log("\nChecking if wallets exist...");
    const allWallets = await db.select().from(wallets).limit(5);
    console.log("Wallets in DB:", allWallets.map(w => w.id));

    // Attempting a mock insert with string IDs if that's what the user has
    const userId = "user_dev"; 
    const walletId = "wallet_dev";
    
    console.log(`\nAttempting to insert transaction for userId: ${userId}, walletId: ${walletId}`);
    
    // This will likely fail if the column is UUID
    await db.insert(transactions).values({
      userId: userId as any,
      walletId: walletId as any,
      txnRef: 'test_' + Date.now(),
      amount: '10.00',
      type: "deposit",
      status: "pending",
      note: "Test insertion",
    });
    
    console.log("✅ Insertion successful!");
  } catch (err) {
    console.error("❌ Insertion failed!");
    console.error(err);
  } finally {
    process.exit(0);
  }
}

testInsert();
