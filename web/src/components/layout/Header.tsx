import { Leaf, Settings } from "lucide-react";
import { Link } from "react-router-dom";

export function Header() {
  return (
    <header className="header">
      <Link to="/" className="brand" aria-label="식물왕 홈">
        <span className="brand-icon">
          <Leaf aria-hidden="true" size={25} />
        </span>
        <span>
          식물왕<small>SIKMULWANG</small>
        </span>
      </Link>
      <div className="header-right">
        <span className="header-tagline">초록과 함께, 조금씩</span>
        <Link
          className="icon-button"
          to="/settings"
          aria-label="설정 및 데이터 관리"
        >
          <Settings size={22} aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
