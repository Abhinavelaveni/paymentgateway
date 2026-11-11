import { redirect } from "next/navigation";

// The merchant admin dashboard lives at /admin (the legacy admin served it at both / and /admin).
export default function Home() {
  redirect("/admin");
}
