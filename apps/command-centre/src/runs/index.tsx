import { useParams } from "react-router-dom";
import RunList from "./RunList";
import RunDetail from "./RunDetail";
import "./runs.css";

export default function Runs() {
  const { id } = useParams();
  if (id) return <RunDetail key={id} id={id} />;
  return <RunList />;
}

export { default as Replay } from "./Replay";
export { useRunningSkills } from "./useRunningSkills";
export { runningSkillMap } from "./runningSkills";
