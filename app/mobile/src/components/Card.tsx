import { View, ViewProps } from 'react-native';

interface Props extends ViewProps {
  children: React.ReactNode;
  noPadding?: boolean;
}

export function Card({ children, noPadding, className, ...props }: Props) {
  return (
    <View
      className={`bg-surface rounded-2xl border border-border ${noPadding ? '' : 'p-4'} ${className ?? ''}`}
      {...props}
    >
      {children}
    </View>
  );
}
