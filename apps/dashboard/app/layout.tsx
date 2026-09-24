import type { ReactNode } from "react";
import "./globals.css";
import { KillButton } from "./kill-button";

export const metadata = { title: "AdPilot" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <nav>
            <a href="/">Campaigns</a>
            <a href="/brands">Brands</a>
            <a href="/brief">New brief</a>
            <a href="/reports">Reports</a>
          </nav>
          <div className="row">
            <form action="/logout" method="post"><button className="small" type="submit">Log out</button></form>
            <KillButton />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
