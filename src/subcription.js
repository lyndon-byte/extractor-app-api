import { db } from './db.js';
import { subscriptions, messageUsage } from './schema.js';
import { eq,and,sql } from 'drizzle-orm';
import axios from 'axios';
import 'dotenv/config';

const MONTHLY_LIMIT = 9;

export async function createSubscription({
  userId,
  subscriptionId,
  name,
  email,
  status
}) {
  try {
    
    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.subscriptionId, subscriptionId))
      .limit(1);

    if (existing.length > 0) {
      return {
        success: true,
        data: existing[0],
      };
    }

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


export async function createCheckoutLink({
  email,
  name,
  uid,
}) {
  try {
    console.log(
      '[LEMONSQUEEZY] Creating checkout link',
      {
        email,
        name,
        uid,
      }
    );

    const response = await axios.post(
      'https://api.lemonsqueezy.com/v1/checkouts',
      {
        data: {
          type: 'checkouts',

          attributes: {
            checkout_data: {
              email,
              name,
              custom: {
                user_id: uid,
              },
            },
          },

          relationships: {
            store: {
              data: {
                type: 'stores',
                id: '378101',
              },
            },
            variant: {
              data: {
                type: 'variants',
                id: '1692708',
              },
            },
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LEMON_SQUEEZY_KEY}`,
          Accept: 'application/vnd.api+json',
          'Content-Type':
            'application/vnd.api+json',
        },
      }
    );

    console.log(
      '[LEMONSQUEEZY] Checkout created successfully',
      {
        checkoutId:
          response.data?.data?.id,
        checkoutUrl:
          response.data?.data?.attributes?.url,
      }
    );

    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    console.error(
      '[LEMONSQUEEZY] Failed to create checkout',
      {
        message: error.message,

        responseStatus:
          error.response?.status,

        responseData:
          error.response?.data,

        requestData: {
          email,
          name,
          uid,
        },
      }
    );

    return {
      success: false,
      error:
        error.response?.data ||
        error.message ||
        'Failed to create checkout link',
    };
  }
}


export async function getSubscriptionOnAPI({subId}) {

  try {
    
    const response = await axios.get(
      `https://api.lemonsqueezy.com/v1/subscriptions/${subId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.LEMON_SQUEEZY_KEY}`,
          Accept: 'application/vnd.api+json',
          'Content-Type':
            'application/vnd.api+json',
        },
      }
    );

    console.log(
      '[LEMONSQUEEZY] get subscription successfully',
      {
        data: response.data?.data,    
      }
    );

    return {
      success: true,
      data: response.data,
    };

  } catch (error) {

    console.error(
      '[LEMONSQUEEZY] Failed to get subscription',
      {
        message: error.message,

        responseStatus:
          error.response?.status,

        responseData:
          error.response?.data,
      }
    );

    return {
      success: false,
      error:
        error.response?.data ||
        error.message ||
        'Failed to get subscription',
    };
  }
}


export async function checkSubscription({userId}){

  try {

    const result = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);

    return {
      success: true,
      data: result[0] || null,
    };
  } catch (error) {
    console.error(
      'Failed to get subscription by user id',
      {
        userId,
        error,
      }
    );

    return {
      success: false,
      error:
        'Failed to retrieve subscription',
    };
  }

}

export async function cancelSubscription({subId}) {
  try {

    const response = await axios.delete(
      `https://api.lemonsqueezy.com/v1/subscriptions/${subId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.LEMON_SQUEEZY_KEY}`,
          Accept: 'application/vnd.api+json',
          'Content-Type':
            'application/vnd.api+json',
        },
      }
    );

    console.log(
      '[LEMONSQUEEZY] Subscription cancelled successfully',
      {
        subId,
        status: response.status,
        data: response.data,
      }
    );

    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    console.error(
      '[LEMONSQUEEZY] Failed to cancel subscription',
      {
        subId,

        message: error.message,

        responseStatus:
          error.response?.status,

        responseData:
          error.response?.data,
      }
    );

    return {
      success: false,
      error:
        error.response?.data ||
        error.message ||
        'Failed to cancel subscription',
    };
  }
}

export async function canSendMessage({ userId }) {
  
  const now = new Date();

  if (!userId) {
    return false;
  }

  const usage = await db
    .select({
      messageCount: messageUsage.messageCount,
    })
    .from(messageUsage)
    .where(
      and(
        eq(messageUsage.userId, userId),
        eq(messageUsage.year, now.getFullYear()),
        eq(messageUsage.month, now.getMonth() + 1)
      )
    )
    .limit(1);

  const count = usage[0].messageCount;

  return count < MONTHLY_LIMIT;

}

export async function incrementMessageCount({userId}) {
  
  const now = new Date();

  await db
    .insert(messageUsage)
    .values({
      userId,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      messageCount: 1,
    })
    .onConflictDoUpdate({
      target: [
        messageUsage.userId,
        messageUsage.year,
        messageUsage.month,
      ],
      set: {
        messageCount: sql`${messageUsage.messageCount} + 1`,
        updatedAt: new Date(),
      },
    });

    
}