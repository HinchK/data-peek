import { NextRequest, NextResponse } from "next/server";
import { db, licenses, activations, teams, teamMembers, customers } from "@/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { isTeamPlan } from "@/lib/license";
import type { TeamInfo, TeamRole } from "@shared/index";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log("[activate] Request body:", JSON.stringify(body));

    const { license_key: rawLicenseKey, name, device_id, os, app_version, email } = body as {
      license_key: string;
      name: string;
      device_id?: string;
      os?: string;
      app_version?: string;
      email?: string;
    };

    // Normalize license key to uppercase (our keys are uppercase)
    const license_key = rawLicenseKey?.toUpperCase().trim();

    if (!license_key || !name) {
      return NextResponse.json(
        { error: "License key and device name are required" },
        { status: 400 }
      );
    }

    // Find license in our database
    const license = await db.query.licenses.findFirst({
      where: eq(licenses.licenseKey, license_key),
    });

    if (!license) {
      return NextResponse.json(
        { error: "License key not found" },
        { status: 404 }
      );
    }

    if (license.status !== "active") {
      return NextResponse.json(
        { error: `License is ${license.status}` },
        { status: 400 }
      );
    }

    // For team plans, verify user is a member of the team
    let teamInfo: TeamInfo | undefined;
    let userRole: TeamRole = "member";

    if (isTeamPlan(license.plan) && license.teamId) {
      // Get team info
      const team = await db.query.teams.findFirst({
        where: eq(teams.id, license.teamId),
      });

      if (!team) {
        return NextResponse.json(
          { error: "Team not found for this license" },
          { status: 400 }
        );
      }

      // Find or create customer for this email
      let customer = email
        ? await db.query.customers.findFirst({
            where: eq(customers.email, email.toLowerCase()),
          })
        : null;

      if (!customer && email) {
        // Create customer if doesn't exist
        const [newCustomer] = await db
          .insert(customers)
          .values({ email: email.toLowerCase() })
          .returning();
        customer = newCustomer;
      }

      // Check if user is a team member
      const membership = customer
        ? await db.query.teamMembers.findFirst({
            where: and(
              eq(teamMembers.teamId, license.teamId),
              eq(teamMembers.customerId, customer.id),
              eq(teamMembers.status, "active")
            ),
          })
        : null;

      if (!membership) {
        return NextResponse.json(
          { error: "You are not a member of this team. Ask the team owner to invite you." },
          { status: 403 }
        );
      }

      userRole = membership.role as TeamRole;

      // Count active team members
      const activeMembers = await db.query.teamMembers.findMany({
        where: and(
          eq(teamMembers.teamId, license.teamId),
          eq(teamMembers.status, "active")
        ),
      });

      teamInfo = {
        id: team.id,
        name: team.name,
        seatCount: license.seatCount || 1,
        seatsUsed: activeMembers.length,
        role: userRole,
      };
    }

    // Check if this device is already activated
    let activation = device_id
      ? await db.query.activations.findFirst({
          where: and(
            eq(activations.licenseId, license.id),
            eq(activations.deviceId, device_id)
          ),
        })
      : null;

    if (activation) {
      // Update existing activation
      await db
        .update(activations)
        .set({
          lastValidatedAt: new Date(),
          appVersion: app_version,
          deviceName: name,
        })
        .where(eq(activations.id, activation.id));

      console.log(`[activate] Updated existing activation for ${license_key}`);
    } else {
      // Count current activations
      const currentActivations = await db.query.activations.findMany({
        where: and(
          eq(activations.licenseId, license.id),
          eq(activations.isActive, true)
        ),
      });

      if (currentActivations.length >= license.maxActivations) {
        return NextResponse.json(
          { error: `Activation limit reached (${license.maxActivations} devices)` },
          { status: 400 }
        );
      }

      // Create new activation
      const instanceId = randomUUID();
      const [newActivation] = await db
        .insert(activations)
        .values({
          licenseId: license.id,
          deviceId: device_id || randomUUID(),
          deviceName: name,
          os,
          appVersion: app_version,
          instanceId,
        })
        .returning();

      activation = newActivation;
      console.log(`[activate] Created new activation for ${license_key}: ${instanceId}`);
    }

    // Check updates availability
    const now = new Date();
    const updatesAvailable = license.updatesUntil > now;

    // Get current activation count
    const currentActivations = await db.query.activations.findMany({
      where: and(
        eq(activations.licenseId, license.id),
        eq(activations.isActive, true)
      ),
    });

    return NextResponse.json({
      success: true,
      id: activation.instanceId,
      license_key,
      name,
      updates_available: updatesAvailable,
      updates_until: license.updatesUntil.toISOString(),
      plan: license.plan,
      devices_used: currentActivations.length,
      devices_allowed: license.maxActivations,
      ...(teamInfo && { team_info: teamInfo }),
    });
  } catch (error) {
    console.error("[activate] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
