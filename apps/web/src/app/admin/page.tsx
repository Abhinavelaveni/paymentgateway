import type { Metadata } from "next";
import AdminShell from "@/components/admin/admin-shell";

export const metadata: Metadata = { title: "Merchant Admin", robots: { index: false, follow: false } };

export default function AdminPage() {
  return <AdminShell />;
}
