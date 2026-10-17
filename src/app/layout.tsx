import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Emote Club", description: "Discordサーバーのみんなで絵文字を作り、素材を共有する場所。" };
export default function Layout({children}: {children: React.ReactNode}) { return <html lang="ja"><body>{children}</body></html>; }
