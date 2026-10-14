import { BookOpen, House, Search, Sprout } from "lucide-react";
import { NavLink } from "react-router-dom";

export const navigation = [
  { path: "/", label: "오늘", icon: House },
  { path: "/discover", label: "식물 찾기", icon: Search },
  { path: "/plants", label: "내 식물", icon: Sprout },
  { path: "/journal", label: "일기장", icon: BookOpen },
];
export function BottomNavigation() {
  return (
    <nav className="primary-navigation" aria-label="주 메뉴">
      {navigation.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          end={path === "/"}
          className={({ isActive }) =>
            isActive ? "nav-item active" : "nav-item"
          }
        >
          <Icon size={22} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
