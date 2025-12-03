import { NextRequest, NextResponse } from "next/server";
import { db, licenses, teams, teamMembers, customers } from "@/db";
import { eq, and } from "drizzle-orm";
import { isTeamPlan } from "@/lib/license";
import { Resend } from "resend";
import type { TeamRole } from "@shared/index";

const resend = new Resend(process.env.RESEND_API_KEY ?? "re_123");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      license_key: rawLicenseKey,
      member_email: memberEmail,
      role = "member",
      inviter_email: inviterEmail,
    } = body as {
      license_key: string;
      member_email: string;
      role?: TeamRole;
      inviter_email?: string;
    };

    const license_key = rawLicenseKey?.toUpperCase().trim();
    const normalizedEmail = memberEmail?.toLowerCase().trim();

    if (!license_key || !normalizedEmail) {
      return NextResponse.json(
        { success: false, error: "License key and member email are required" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json(
        { success: false, error: "Invalid email format" },
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

    // Check seat availability
    const activeMembers = await db.query.teamMembers.findMany({
      where: and(
        eq(teamMembers.teamId, license.teamId),
        eq(teamMembers.status, "active")
      ),
    });

    const seatCount = license.seatCount || 1;
    if (activeMembers.length >= seatCount) {
      return NextResponse.json(
        { success: false, error: `All ${seatCount} seats are in use. Upgrade to add more members.` },
        { status: 400 }
      );
    }

    // Find or create customer for the invited member
    let customer = await db.query.customers.findFirst({
      where: eq(customers.email, normalizedEmail),
    });

    if (!customer) {
      const [newCustomer] = await db
        .insert(customers)
        .values({ email: normalizedEmail })
        .returning();
      customer = newCustomer;
    }

    // Check if already a member
    const existingMembership = await db.query.teamMembers.findFirst({
      where: and(
        eq(teamMembers.teamId, license.teamId),
        eq(teamMembers.customerId, customer.id)
      ),
    });

    if (existingMembership) {
      if (existingMembership.status === "active") {
        return NextResponse.json(
          { success: false, error: "This person is already a team member" },
          { status: 400 }
        );
      }
      // Reactivate removed member
      await db
        .update(teamMembers)
        .set({
          status: "active",
          role,
          joinedAt: new Date(),
        })
        .where(eq(teamMembers.id, existingMembership.id));

      return NextResponse.json({
        success: true,
        memberId: existingMembership.id,
        message: "Team member reactivated",
      });
    }

    // Find inviter customer ID if provided
    let inviterId: string | undefined;
    if (inviterEmail) {
      const inviter = await db.query.customers.findFirst({
        where: eq(customers.email, inviterEmail.toLowerCase()),
      });
      inviterId = inviter?.id;
    }

    // Create team membership
    const [newMember] = await db
      .insert(teamMembers)
      .values({
        teamId: license.teamId,
        customerId: customer.id,
        role,
        status: "active",
        invitedBy: inviterId,
        joinedAt: new Date(),
      })
      .returning();

    // Send invitation email
    if (process.env.RESEND_API_KEY) {
      try {
        await resend.emails.send({
          from: "data-peek <hello@send.datapeek.dev>",
          to: normalizedEmail,
          subject: `You've been added to ${team.name} on data-peek`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #22d3ee;">Welcome to ${team.name}!</h1>

              <p>Hi there,</p>

              <p>You've been added to the <strong>${team.name}</strong> team on data-peek.</p>

              <div style="background: #111113; border: 1px solid #27272a; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <p style="color: #a1a1aa; margin: 0 0 8px 0; font-size: 14px;">Team License Key:</p>
                <p style="color: #fafafa; font-family: monospace; font-size: 18px; margin: 0; letter-spacing: 1px;">${license_key}</p>
              </div>

              <h3>Get Started:</h3>
              <ol>
                <li>Download data-peek from <a href="https://datapeek.dev/download" style="color: #22d3ee;">datapeek.dev/download</a></li>
                <li>Open the app and go to <strong>Settings → License</strong></li>
                <li>Enter the team license key above</li>
                <li>Use your email (${normalizedEmail}) when activating</li>
              </ol>

              <p>Need help? Just reply to this email.</p>

              <p>Happy querying!<br>— The data-peek team</p>
            </div>
          `,
        });
      } catch (emailError) {
        console.error("[team/invite] Failed to send invitation email:", emailError);
      }
    }

    return NextResponse.json({
      success: true,
      memberId: newMember.id,
      message: "Team member added successfully",
    });
  } catch (error) {
    console.error("[team/invite] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to invite team member" },
      { status: 500 }
    );
  }
}
