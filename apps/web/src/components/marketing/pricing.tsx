import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, Heart, Github, ArrowRight, Sparkles } from 'lucide-react'
import { CheckoutButton } from './checkout-button'

const plans = [
  {
    name: 'Personal',
    price: '$0',
    period: 'forever',
    description: 'All features, personal use only',
    features: [
      { text: 'All features unlocked', included: true },
      { text: 'AI Assistant (BYOK)', included: true },
      { text: 'PostgreSQL, MySQL, SQL Server', included: true },
      { text: 'Unlimited connections', included: true },
      { text: 'Unlimited query history', included: true },
      { text: 'All future updates', included: true },
      { text: 'Personal projects & learning', included: true },
      { text: 'Students & educators', included: true },
    ],
    cta: 'Download Free',
    href: '/download',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$29',
    originalPrice: '$99',
    period: 'year',
    description: 'For commercial use at work',
    badge: 'Early Bird — 70% off',
    features: [
      { text: 'Everything in Personal', included: true },
      { text: 'Commercial use allowed', included: true },
      { text: 'Use at work & for clients', included: true },
      { text: '1 year of updates included', included: true },
      { text: '3 device activations', included: true },
      { text: 'Perpetual fallback license', included: true },
      { text: '30-day money-back guarantee', included: true },
    ],
    cta: 'Get Pro License',
    href: '#buy',
    highlighted: true,
  },
]

export function Pricing() {
  return (
    <section id="pricing" className="relative py-20 sm:py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[--color-surface]/50 to-transparent" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6">
        {/* Section Header */}
        <div className="text-center mb-10 sm:mb-16">
          <p
            className="text-xs uppercase tracking-[0.2em] text-[--color-accent] mb-3 sm:mb-4"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            Pricing
          </p>
          <h2
            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight mb-4 sm:mb-6 px-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Open source.
            <br />
            <span className="text-[--color-text-secondary]">Pay for commercial use.</span>
          </h2>
          <p
            className="text-base sm:text-lg text-[--color-text-secondary] max-w-xl mx-auto px-2"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Free for personal use. A license supports development and is required
            for commercial use in for-profit organizations.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 max-w-4xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-xl sm:rounded-2xl p-5 sm:p-8 ${
                plan.highlighted
                  ? 'bg-gradient-to-b from-[--color-accent]/10 to-[--color-surface] border-2 border-[--color-accent]/50'
                  : 'bg-[--color-surface] border border-[--color-border]'
              }`}
            >
              {/* Badge */}
              {plan.badge && (
                <div className="absolute -top-4 inset-x-0 flex justify-center z-10">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium bg-[#0a0a0a] text-[--color-accent] border border-[--color-accent]/50 whitespace-nowrap" style={{ fontFamily: 'var(--font-mono)' }}>
                    <Sparkles className="w-3 h-3" />
                    {plan.badge}
                  </span>
                </div>
              )}

              {/* Plan Header */}
              <div className="mb-6 sm:mb-8">
                <h3
                  className="text-lg sm:text-xl font-medium mb-2"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {plan.name}
                </h3>
                <div className="flex items-baseline gap-2 mb-2">
                  <span
                    className="text-4xl sm:text-5xl font-semibold"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {plan.price}
                  </span>
                  {plan.originalPrice && (
                    <span className="text-lg sm:text-xl text-[--color-text-muted] line-through">
                      {plan.originalPrice}
                    </span>
                  )}
                  <span className="text-sm sm:text-base text-[--color-text-muted]">/{plan.period}</span>
                </div>
                <p className="text-xs sm:text-sm text-[--color-text-secondary]">{plan.description}</p>
              </div>

              {/* Features */}
              <ul className="space-y-2.5 sm:space-y-3 mb-6 sm:mb-8">
                {plan.features.map((feature) => (
                  <li key={feature.text} className="flex items-center gap-2.5 sm:gap-3">
                    <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-[--color-success]/10 flex items-center justify-center flex-shrink-0">
                      <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[--color-success]" />
                    </div>
                    <span className="text-xs sm:text-sm text-[--color-text-primary]">
                      {feature.text}
                    </span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              {plan.highlighted ? (
                <CheckoutButton className="w-full text-sm sm:text-base" />
              ) : (
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full text-sm sm:text-base"
                  asChild
                >
                  <Link href={plan.href}>
                    {plan.cta}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
              )}
            </div>
          ))}
        </div>

        {/* Honor System Notice */}
        <div className="mt-8 sm:mt-12 p-4 sm:p-6 rounded-lg sm:rounded-xl bg-[--color-surface] border border-[--color-border] max-w-2xl mx-auto">
          <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-[--color-accent]/10 flex items-center justify-center flex-shrink-0">
              <Heart className="w-4 h-4 sm:w-5 sm:h-5 text-[--color-accent]" />
            </div>
            <div>
              <h4
                className="text-sm sm:text-base font-medium mb-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Honor System Licensing
              </h4>
              <p className="text-xs sm:text-sm text-[--color-text-secondary] mb-2 sm:mb-3">
                Inspired by{' '}
                <Link
                  href="https://yaak.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[--color-accent] hover:underline"
                >
                  Yaak
                </Link>{' '}
                and other sustainable indie software. No DRM, no aggressive enforcement.
                We trust you to do the right thing.
              </p>
              <p className="text-xs sm:text-sm text-[--color-text-secondary]">
                <strong>Students:</strong> Use it free! Just reach out for a free license.
              </p>
              <p className="text-xs sm:text-sm text-[--color-text-muted] mt-2">
                Questions?{' '}
                <Link
                  href="https://x.com/gillarohith"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[--color-accent] hover:underline"
                >
                  @gillarohith
                </Link>{' '}
                or{' '}
                <Link
                  href="mailto:gillarohith1@gmail.com"
                  className="text-[--color-accent] hover:underline"
                >
                  gillarohith1@gmail.com
                </Link>
              </p>
            </div>
          </div>
        </div>

        {/* Open Source Notice */}
        <div className="mt-5 sm:mt-6 text-center">
          <Link
            href="https://github.com/Rohithgilla12/data-peek"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-[--color-surface] border border-[--color-border] text-xs sm:text-sm text-[--color-text-secondary] hover:text-[--color-text-primary] hover:border-[--color-text-muted] transition-colors"
          >
            <Github className="w-4 h-4" />
            <span>View source on GitHub — MIT Licensed</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
