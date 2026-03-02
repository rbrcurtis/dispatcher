import type { Route } from "./+types/home";
import { Board } from "~/components/Board";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Dispatch" },
    { name: "description", content: "Personal kanban board + Claude Code orchestration" },
  ];
}

export default function Home() {
  return <Board />;
}
