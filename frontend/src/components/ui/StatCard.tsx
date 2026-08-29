interface StatCardProps {
  value: string | number;
  label: string;
  variant?: 'default' | 'cr' | 'en' | 'vu' | 'info';
  icon?: string;
}

export default function StatCard({ value, label, variant = 'default', icon }: StatCardProps) {
  return (
    <div className={`stat-card stat-${variant}`}>
      {icon && <span className="stat-icon">{icon}</span>}
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
