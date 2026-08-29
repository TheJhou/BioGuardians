interface StatCardProps {
  value: string | number;
  label: string;
  variant?: 'default' | 'cr' | 'en' | 'vu' | 'info';
}

export default function StatCard({ value, label, variant = 'default' }: StatCardProps) {
  return (
    <div className={`stat-card stat-${variant}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
