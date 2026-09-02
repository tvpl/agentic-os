import { useParams } from "react-router-dom";
import RunList from "./RunList";
import RunDetail from "./RunDetail";

export default function Runs() {
  const { id } = useParams();
  if (id) return <RunDetail key={id} id={id} />;
  return <RunList />;
}
