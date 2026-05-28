import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { View } from 'react-native';

interface Props {
  progress: number;       // 0–100
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  sublabel?: string;
}

export function ProgressRing({
  progress,
  size = 160,
  strokeWidth = 14,
  color = '#6366f1',
  label,
  sublabel,
}: Props) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.min(100, Math.max(0, progress));
  const offset = circumference - (clampedProgress / 100) * circumference;
  const center = size / 2;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {/* Track */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke="#1e2035"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
        {/* Center text via SVG */}
        {label && (
          <SvgText
            x={center}
            y={center - (sublabel ? 8 : 4)}
            textAnchor="middle"
            fontSize={size > 120 ? 28 : 20}
            fontWeight="bold"
            fill="#f1f5f9"
          >
            {label}
          </SvgText>
        )}
        {sublabel && (
          <SvgText
            x={center}
            y={center + 20}
            textAnchor="middle"
            fontSize={12}
            fill="#64748b"
          >
            {sublabel}
          </SvgText>
        )}
      </Svg>
    </View>
  );
}
