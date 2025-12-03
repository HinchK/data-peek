import { randomBytes } from 'crypto'

// Characters that won't be confused (no 0, O, 1, I, l)
const LICENSE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Plan configuration
export const PLAN_CONFIG = {
  pro: {
    prefix: 'DPRO',
    maxActivations: 3,
    defaultSeatCount: 1,
  },
  team: {
    prefix: 'DTEAM',
    maxActivationsPerSeat: 2, // Each team member can activate on 2 devices
    defaultSeatCount: 5,
    minSeats: 3,
    maxSeats: 100,
  },
  enterprise: {
    prefix: 'DENT',
    maxActivationsPerSeat: 3,
    defaultSeatCount: 10,
    minSeats: 10,
    maxSeats: 1000,
  },
} as const

export type PlanType = keyof typeof PLAN_CONFIG

/**
 * Generate a license key in the format: DPRO-XXXX-XXXX-XXXX-XXXX
 */
export function generateLicenseKey(prefix: string = 'DPRO'): string {
  const segments: string[] = []

  for (let i = 0; i < 4; i++) {
    let segment = ''
    for (let j = 0; j < 4; j++) {
      const randomIndex = randomBytes(1)[0] % LICENSE_CHARS.length
      segment += LICENSE_CHARS[randomIndex]
    }
    segments.push(segment)
  }

  return `${prefix}-${segments.join('-')}`
}

/**
 * Validate license key format
 */
export function isValidLicenseKeyFormat(key: string): boolean {
  // Format: PREFIX-XXXX-XXXX-XXXX-XXXX
  const pattern = /^[A-Z]{4,5}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/
  return pattern.test(key)
}

/**
 * Get plan from license key prefix
 */
export function getPlanFromKey(key: string): 'pro' | 'team' | 'enterprise' | null {
  if (key.startsWith('DPRO-')) return 'pro'
  if (key.startsWith('DTEAM-')) return 'team'
  if (key.startsWith('DENT-')) return 'enterprise'
  return null
}

/**
 * Check if a plan is a team-based plan
 */
export function isTeamPlan(plan: string): boolean {
  return plan === 'team' || plan === 'enterprise'
}

/**
 * Get max activations for a plan
 */
export function getMaxActivations(plan: PlanType, seatCount: number = 1): number {
  const config = PLAN_CONFIG[plan]
  if (plan === 'pro') {
    return config.maxActivations
  }
  // For team/enterprise plans, multiply activations per seat by seat count
  return ('maxActivationsPerSeat' in config ? config.maxActivationsPerSeat : 2) * seatCount
}

/**
 * Get the license key prefix for a plan
 */
export function getPrefixForPlan(plan: PlanType): string {
  return PLAN_CONFIG[plan].prefix
}

/**
 * Calculate updates expiration date (1 year from purchase)
 */
export function calculateUpdatesUntil(purchaseDate: Date = new Date()): Date {
  const expiry = new Date(purchaseDate)
  expiry.setFullYear(expiry.getFullYear() + 1)
  return expiry
}
