import { Flower2, Leaf, Sprout, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { DemoPlant } from "../../features/discover/demo-catalog";
import { StatusBadge } from "./Feedback";

export function PlantCard({
  plant,
  groupLabel,
  search = "",
}: {
  plant: DemoPlant;
  groupLabel?: string;
  search?: string;
}) {
  const Icon = { leaf: Leaf, sprout: Sprout, flower: Flower2 }[plant.visual];
  return (
    <article className="plant-card">
      <div className={`plant-visual ${plant.visual}`}>
        <Icon size={70} strokeWidth={1.2} aria-hidden="true" />
        <span>개발용 샘플</span>
      </div>
      <div className="plant-content">
        <div className="card-meta">
          <span>
            {plant.category} · {plant.place}
          </span>
          <StatusBadge>정보 부족</StatusBadge>
        </div>
        <h2>{plant.name}</h2>
        {groupLabel && <p>{groupLabel}</p>}
        <p>
          난이도: {plant.difficulty} <span className="muted">(가상 값)</span>
        </p>
        <p className="field-hint">{plant.reason}</p>
        <Link className="text-link" to={`/discover/${plant.id}${search}`}>
          {plant.name} 상세정보 <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
