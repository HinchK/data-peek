import { Metadata } from "next";
import { Header } from "@/components/marketing/header";
import { Hero } from "@/components/marketing/hero";
import { ClipPlayer } from "@/components/marketing/clip-player";
import { clipById } from "@/components/marketing/feature-clips";
import { Features } from "@/components/marketing/features";
import { Pricing } from "@/components/marketing/pricing";
import { Faq } from "@/components/marketing/faq";
import { Cta } from "@/components/marketing/cta";
import { Footer } from "@/components/marketing/footer";
import { generateMetadata as generateSeoMetadata } from "@/lib/seo";

export const metadata: Metadata = generateSeoMetadata({
  title: "data-peek | Fast PostgreSQL Client for Developers",
  description:
    "A lightning-fast, AI-powered database client for PostgreSQL, MySQL, SQL Server, and SQLite. Query, explore, and edit your data with a keyboard-first experience. Free for personal use.",
  keywords: [
    "PostgreSQL client",
    "MySQL client",
    "SQL Server client",
    "SQLite client",
    "database client",
    "SQL editor",
    "database management tool",
    "pgAdmin alternative",
    "DBeaver alternative",
    "TablePlus alternative",
    "AI SQL assistant",
    "database GUI",
    "SQL query tool",
    "database explorer",
  ],
  path: "/",
});

export default function Home() {
  return (
    <div className="neat min-h-screen">
      <Header />
      <main>
        <Hero />
        {/* Task 4 review-gate scaffolding: proves the capture -> encode ->
            embed pipeline with one real clip before the rest are captured.
            Task 9 replaces this with the full tabbed showcase. */}
        <section className="mx-auto max-w-[1240px] px-5 sm:px-8 py-12">
          <ClipPlayer clip={clipById("command-palette")!} active />
        </section>
        <Features />
        <Pricing />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </div>
  );
}
