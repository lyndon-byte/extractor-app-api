import { db } from './db.js';
import { subscriptions } from './schema.js';
import { eq } from 'drizzle-orm';


export async function createSubscription({
  userId,
  subscriptionId,
  name,
  email,
  status
}) {
  try {
    const result = await db
     .insert(subscriptions)
     .values({
        userId,
        subscriptionId,
        name,
        email,
        status,
    })
    .returning();

    return {
      success: true,
      data: result[0],
    };

  } catch (error) {

    console.error('Create Subscription Error:', error);

    return {
      success: false,
      error: 'Failed to create subscription',
    };

  }
}


export async function updateSubscription({
  subscriptionId,
  status
}) {
  try {
    const result = await db
      .update(subscriptions)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.subscriptionId, subscriptionId))
      .returning();

    if (result.length === 0) {
      return {
        success: false,
        error: 'Subscription not found',
      };
    }

    return {
      success: true,
      data: result[0],
    };
  } catch (error) {
    console.error('Update Subscription Error:', error);

    return {
      success: false,
      error: 'Failed to update subscription',
    };
  }
}