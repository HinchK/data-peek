'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Plus, Settings, Loader2 } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { useConnectionStore } from '@/stores'
import { useNavigate } from '@tanstack/react-router'
import { AddConnectionDialog } from './add-connection-dialog'
import type { DatabaseType } from '@shared/index'

// Database type icons as simple SVG components
function PostgreSQLIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
      <path d="M12 6v6l4 2" />
      <text x="8" y="17" fontSize="8" fontWeight="bold" fill="currentColor" stroke="none">
        PG
      </text>
    </svg>
  )
}

function MySQLIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  )
}

function DatabaseIcon({
  dbType,
  className
}: {
  dbType: DatabaseType | undefined
  className?: string
}) {
  switch (dbType) {
    case 'mysql':
      return <MySQLIcon className={className} />
    case 'postgresql':
    default:
      return <PostgreSQLIcon className={className} />
  }
}

export function ConnectionSwitcher() {
  const navigate = useNavigate()
  const connections = useConnectionStore((s) => s.connections)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const setActiveConnection = useConnectionStore((s) => s.setActiveConnection)
  const setConnectionStatus = useConnectionStore((s) => s.setConnectionStatus)
  const initializeConnections = useConnectionStore((s) => s.initializeConnections)
  const isInitialized = useConnectionStore((s) => s.isInitialized)

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)

  // Initialize connections from persistent storage on mount
  useEffect(() => {
    initializeConnections()
  }, [initializeConnections])

  const activeConnection = connections.find((c) => c.id === activeConnectionId)

  const handleSelectConnection = async (connectionId: string) => {
    // Set connecting status
    setConnectionStatus(connectionId, { isConnecting: true, error: undefined })

    // Simulate connection (in real app, this would be IPC call)
    setTimeout(() => {
      setConnectionStatus(connectionId, { isConnecting: false, isConnected: true })
      setActiveConnection(connectionId)
    }, 500)
  }

  const handleManageConnections = () => {
    navigate({ to: '/settings' })
  }

  // Show loading state while initializing
  if (!isInitialized) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton className="w-fit px-1.5">
            <div className="flex aspect-square size-5 items-center justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
            <span className="truncate font-medium text-muted-foreground">Loading...</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  if (connections.length === 0) {
    return (
      <>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="w-fit px-1.5" onClick={() => setIsAddDialogOpen(true)}>
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-5 items-center justify-center rounded-md">
                <Plus className="size-3" />
              </div>
              <span className="truncate font-medium">Add connection</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <AddConnectionDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />
      </>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="w-fit px-1.5">
              <div className="relative flex aspect-square size-5 items-center justify-center">
                <DatabaseIcon dbType={activeConnection?.dbType} className="size-4 text-sidebar-primary" />
                {activeConnection?.isConnected && (
                  <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-green-500 ring-1 ring-sidebar" />
                )}
                {activeConnection?.isConnecting && (
                  <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-yellow-500 ring-1 ring-sidebar animate-pulse" />
                )}
              </div>
              <span className="truncate font-medium">
                {activeConnection?.name || 'Select connection'}
              </span>
              <ChevronDown className="opacity-50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-72 rounded-lg"
            align="start"
            side="bottom"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Connections
            </DropdownMenuLabel>
            {connections.map((connection, index) => (
              <DropdownMenuItem
                key={connection.id}
                onClick={() => handleSelectConnection(connection.id)}
                className="gap-2 p-2"
                disabled={connection.isConnecting}
              >
                <div className="relative flex size-6 items-center justify-center rounded-xs border">
                  {connection.isConnecting ? (
                    <Loader2 className="size-4 shrink-0 animate-spin" />
                  ) : (
                    <DatabaseIcon dbType={connection.dbType} className="size-4 shrink-0" />
                  )}
                  {connection.isConnected && !connection.isConnecting && (
                    <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-green-500 ring-1 ring-background" />
                  )}
                </div>
                <div className="flex flex-1 flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{connection.name}</span>
                    <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                      {connection.dbType === 'mysql' ? 'MySQL' : 'PG'}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {connection.host}:{connection.port}/{connection.database}
                  </span>
                </div>
                {index < 9 && <DropdownMenuShortcut>⌘⇧{index + 1}</DropdownMenuShortcut>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2" onClick={() => setIsAddDialogOpen(true)}>
              <div className="bg-background flex size-6 items-center justify-center rounded-md border">
                <Plus className="size-4" />
              </div>
              <div className="text-muted-foreground font-medium">Add connection</div>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 p-2" onClick={handleManageConnections}>
              <div className="bg-background flex size-6 items-center justify-center rounded-md border">
                <Settings className="size-4" />
              </div>
              <div className="text-muted-foreground font-medium">Manage connections</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <AddConnectionDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />
    </SidebarMenu>
  )
}
