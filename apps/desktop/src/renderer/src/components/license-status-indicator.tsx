'use client'

import { useEffect } from 'react'
import { Check, AlertCircle, User, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useLicenseStore } from '@/stores/license-store'

export function LicenseStatusIndicator() {
  const { status, isLoading, checkLicense, openActivationModal, openSettingsModal } =
    useLicenseStore()

  // Check license on mount
  useEffect(() => {
    checkLicense()
  }, [checkLicense])

  if (isLoading && !status) {
    return null
  }

  if (!status) {
    return null
  }

  const handleClick = () => {
    if (status.type === 'personal') {
      openActivationModal()
    } else {
      openSettingsModal()
    }
  }

  // Personal use
  if (status.type === 'personal') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleClick}
            >
              <User className="size-3" />
              Personal Use
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Using data-peek for personal, non-commercial use.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Click to activate a license for commercial use.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Expired license
  if (status.daysUntilExpiry !== null && status.daysUntilExpiry <= 0) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 px-2 text-xs text-amber-500 hover:text-amber-400"
              onClick={handleClick}
            >
              <AlertCircle className="size-3" />
              License Expired
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Your license has expired.</p>
            <p className="text-xs text-muted-foreground mt-1">
              {status.perpetualVersion
                ? `You can continue using v${status.perpetualVersion} for commercial use.`
                : 'Click to renew your license.'}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Expiring soon (within 14 days)
  if (status.daysUntilExpiry !== null && status.daysUntilExpiry <= 14) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 px-2 text-xs text-amber-500 hover:text-amber-400"
              onClick={handleClick}
            >
              <AlertCircle className="size-3" />
              {status.daysUntilExpiry} days left
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Your license expires in {status.daysUntilExpiry} days.</p>
            <p className="text-xs text-muted-foreground mt-1">Click to manage your license.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Determine if this is a team license
  const isTeamLicense = status.type === 'team' || status.teamInfo

  // Active license
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1.5 px-2 text-xs text-green-500 hover:text-green-400"
            onClick={handleClick}
          >
            {isTeamLicense ? <Users className="size-3" /> : <Check className="size-3" />}
            {isTeamLicense ? 'Team License' : 'Pro License'}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {isTeamLicense ? 'Team' : 'Individual'} license active
            {status.email && ` (${status.email})`}
          </p>
          {status.teamInfo && (
            <p className="text-xs text-muted-foreground mt-1">
              {status.teamInfo.name} ({status.teamInfo.seatsUsed}/{status.teamInfo.seatCount} seats)
            </p>
          )}
          {status.daysUntilExpiry && (
            <p className="text-xs text-muted-foreground mt-1">
              Renews in {status.daysUntilExpiry} days
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
