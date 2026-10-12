import { usePanelParams } from "../desktop/appRoute";
import RunList from "./RunList";
import RunDetail from "./RunDetail";
import "./runs.css";

export default function Runs() {
  const { id } = usePanelParams<"id">("/runs/:id?");
  if (id) return <RunDetail key={id} id={id} />;
  return <RunList />;
}
