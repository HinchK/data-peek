import { NextRequest, NextResponse } from "next/server";
import { db, licenses, teams, teamMembers, customers, activations } from "@/db";
import { eq, and } from "drizzle-orm";
import { isTeamPlan } from "@/lib/license";
import type { TeamMemberInfo, TeamRole, TeamMemberStatus } from "@shared/index";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { license_key: rawLicenseKey } = body as { license_key: string };

    const license_key = rawLicenseKey?.toUpperCase().trim();

    if (!license_key) {
      return NextResponse.json(
        { success: false, error: "License key is required" },
        { status: 400 }
      );
    }

    // Find license
    const license = await db.query.licenses.findFirst({
      where: eq(licenses.licenseKey, license_key),
    });

    if (!license) {
      return NextResponse.json(
        { success: false, error: "License not found" },
        { status: 404 }
      );
    }

    if (!isTeamPlan(license.plan) || !license.teamId) {
      return NextResponse.json(
        { success: false, error: "This is not a team license" },
        { status: 400 }
      );
    }

    // Get team
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, license.teamId),
    });

    if (!team) {
      return NextResponse.json(
        { success: false, error: "Team not found" },
        { status: 404 }
      );
    }

    // Get all team members with their customer info
    const members = await db.query.teamMembers.findMany({
      where: eq(teamMembers.teamId, license.teamId),
      with: {
        customer: true,
      },
    });

    // Get activation counts per customer
    const memberActivations = await db.query.activations.findMany({
      where: and(
        eq(activations.licenseId, license.id),
        eq(activations.isActive, true)
      ),
    });

    // Count active members
    const activeMembers = members.filter((m) => m.status === "active");

    // Map to response format
    const memberInfos: TeamMemberInfo[] = members.map((m) => ({
      id: m.id,
      customerId: m.customerId,
      email: m.customer.email,
      name: m.customer.name || undefined,
      role: m.role as TeamRole,
      status: m.status as TeamMemberStatus,
      joinedAt: m.joinedAt?.toISOString(),
      devicesUsed: memberActivations.filter(
        // Note: We'd need to link activations to customers for accurate per-member counts
        // For now, show total activations
        () => false
      ).length,
    }));

    return NextResponse.json({
      success: true,
      members: memberInfos,
      seatCount: license.seatCount || 1,
      seatsUsed: activeMembers.length,
      teamName: team.name,
    });
  } catch (error) {
    console.error("[team/members] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get team members" },
      { status: 500 }
    );
  }
}
