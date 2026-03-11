import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "GovPilot — SAM.gov Bid Feed",
  description: "Local SAM.gov contract opportunity scanner for resellers and suppliers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <span className="app-logo">
            Gov<span>Pilot</span>
          </span>
          <nav className="app-nav">
            <Link href="/" className="app-nav-link">
              Bid Feed
            </Link>
            <Link href="/saas-ops" className="app-nav-link">
              SaaS Ops
            </Link>
            <Link href="/miami-contractors" className="app-nav-link">
              Miami Contractors
            </Link>
            <Link href="/miami-contractor-emails" className="app-nav-link">
              Contractor Emails
            </Link>
            <Link href="/miami-companies" className="app-nav-link">
              Miami Companies
            </Link>
          </nav>
        </header>
        <main className="page-wrapper">{children}</main>
      </body>
    </html>
  );
}
