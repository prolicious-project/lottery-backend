import { db } from './src/db';
import { levelPools } from './src/db/schema';
import { eq } from 'drizzle-orm';

async function updatePools() {
    try {
        console.log("Updating all level pools to have requiredCount = 4...");
        const result = await db.update(levelPools).set({ requiredCount: 4 });
        console.log("Update complete.");
        process.exit(0);
    } catch (e) {
        console.error("Error updating pools:", e);
        process.exit(1);
    }
}

updatePools();
