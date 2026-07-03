import { db } from "./db/index";
import { draws, gameTypes } from "./db/schema";
import { eq, desc } from "drizzle-orm";

async function debug() {
  try {
    console.log("Testing DB connection and query...");
    console.log("Fetching all draws with game type names...");
    
    const page = 1;
    const limit = 10;
    const offset = 0;

    console.log("Executing main query...");
    const allDraws = await db
      .select({
        id:             draws.id,
        name:           draws.name,
        status:         draws.status,
        gameTypeName:   gameTypes.name,
      })
      .from(draws)
      .leftJoin(gameTypes, eq(draws.gameTypeId, gameTypes.id))
      .orderBy(desc(draws.createdAt))
      .limit(limit)
      .offset(offset);

    console.log("Main query results:", allDraws.length);

    console.log("Executing count query...");
    const countResult = await db
      .select({ id: draws.id })
      .from(draws);
    
    console.log("Count query results:", countResult.length);
    
    console.log("Success!");
    process.exit(0);
  } catch (error) {
    console.error("DEBUG ERROR:", error);
    process.exit(1);
  }
}

debug();
