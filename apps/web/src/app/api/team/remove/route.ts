import { NextRequest, NextResponse } from "next/server";
import { db, licenses, teams, teamMembers, activations } from "@/db";
import { eq, and } from "drizzle-orm";
import { isTeamPlan } from "@/lib/license";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { license_key: rawLicenseKey, member_id: memberId } = body as {
      license_key: string;
      member_id: string;
    };

    const license_key = rawLicenseKey?.toUpperCase().trim();

    if (!license_key || !memberId) {
      return NextResponse.json(
        { success: false, error: "License key and member ID are required" },
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

    // Find the team member
    const member = await db.query.teamMembers.findFirst({
      where: and(
        eq(teamMembers.id, memberId),
        eq(teamMembers.teamId, license.teamId)
      ),
    });

    if (!member) {
      return NextResponse.json(
        { success: false, error: "Team member not found" },
        { status: 404 }
      );
    }

    // Don't allow removing the owner
    if (member.role === "owner") {
      return NextResponse.json(
        { success: false, error: "Cannot remove the team owner" },
        { status: 400 }
      );
    }

    // Mark member as removed
    await db
      .update(teamMembers)
      .set({ status: "removed" })
      .where(eq(teamMembers.id, memberId));

    // Deactivate all their device activations
    // Note: In a real implementation, we'd want to track which activations belong to which team member
    // For now, we just mark the member as removed and their activations will fail validation

    return NextResponse.json({
      success: true,
      message: "Team member removed successfully",
    });
  } catch (error) {
    console.error("[team/remove] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to remove team member" },
      { status: 500 }
    );
  }
}
