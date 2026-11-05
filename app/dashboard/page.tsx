import { redirect } from "next/navigation";

// Home (tiles per dashboard) comes later in the build order; until then the day starts at Today.
export default function DashboardHome() {
  redirect("/dashboard/pipeline");
}
