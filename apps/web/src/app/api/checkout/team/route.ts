import { NextRequest, NextResponse } from 'next/server'
import DodoPayments from 'dodopayments'
import { PLAN_CONFIG } from '@/lib/license'

const client = new DodoPayments({
  bearerToken: process.env.DODO_API_KEY,
  environment: process.env.NODE_ENV === 'production' ? 'live_mode' : 'test_mode',
})

// Product ID for data-peek Team license
const TEAM_LICENSE_PRODUCT_ID = process.env.DODO_TEAM_PRODUCT_ID || 'prd_team_xxx'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { email, name, teamName, seatCount } = body as {
      email?: string
      name?: string
      teamName?: string
      seatCount?: number
    }

    // Validate seat count
    const seats = seatCount || PLAN_CONFIG.team.defaultSeatCount
    if (seats < PLAN_CONFIG.team.minSeats || seats > PLAN_CONFIG.team.maxSeats) {
      return NextResponse.json(
        { error: `Seat count must be between ${PLAN_CONFIG.team.minSeats} and ${PLAN_CONFIG.team.maxSeats}` },
        { status: 400 }
      )
    }

    if (!teamName) {
      return NextResponse.json({ error: 'Team name is required' }, { status: 400 })
    }

    const checkoutSession = await client.checkoutSessions.create({
      product_cart: [
        {
          product_id: TEAM_LICENSE_PRODUCT_ID,
          quantity: seats,
        },
      ],
      ...(email && {
        customer: {
          email,
          ...(name && { name }),
        },
      }),
      billing_currency: 'USD',
      return_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://datapeek.dev'}/download?purchase=success&plan=team`,
      metadata: {
        source: 'website',
        plan: 'team',
        team_name: teamName,
        seat_count: seats.toString(),
      },
    })

    return NextResponse.json({
      checkout_url: checkoutSession.checkout_url,
      session_id: checkoutSession.session_id,
    })
  } catch (error) {
    console.error('Team checkout session creation failed:', error)

    if (error instanceof DodoPayments.APIError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status || 500 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
