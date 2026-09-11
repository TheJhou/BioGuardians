interface GraficoIconProps {
  size?: number;
  color?: string;
  className?: string;
}

// Ícone de gráfico de barras — verde por padrão, fundo transparente
// (as barras são vazadas pelo fill-rule, então aparece a cor da página atrás)
export default function GraficoIcon({
  size = 24,
  color = 'var(--green-primary)',
  className,
}: GraficoIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M19,3 L5,3 C3.9,3 3,3.9 3,5 L3,19 C3,20.1 3.9,21 5,21 L19,21 C20.1,21 21,20.1 21,19 L21,5 C21,3.9 20.1,3 19,3 Z M9,17 L7,17 L7,10 L9,10 Z M13,17 L11,17 L11,7 L13,7 Z M17,17 L15,17 L15,13 L17,13 Z"
      />
    </svg>
  );
}
