import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { createLogoutCookie } from "~/lib/auth.server";

export async function action({ request }: Route.ActionArgs) {
  return redirect("/login", {
    headers: {
      "Set-Cookie": createLogoutCookie(),
    },
  });
}

export async function loader() {
  return redirect("/");
}
