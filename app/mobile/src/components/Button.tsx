import { TouchableOpacity, Text, ActivityIndicator, TouchableOpacityProps } from 'react-native';

interface ButtonProps extends TouchableOpacityProps {
  label: string;
  loading?: boolean;
  variant?: 'primary' | 'outline' | 'ghost';
}

export function Button({ label, loading, variant = 'primary', ...props }: ButtonProps) {
  const base = 'rounded-xl py-4 items-center justify-center';
  const variants = {
    primary: 'bg-primary',
    outline: 'border border-primary',
    ghost: '',
  };
  const textVariants = {
    primary: 'text-white font-semibold text-base',
    outline: 'text-primary font-semibold text-base',
    ghost: 'text-text-secondary text-base',
  };

  return (
    <TouchableOpacity
      className={`${base} ${variants[variant]} ${props.disabled ? 'opacity-50' : ''}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : '#6366f1'} />
      ) : (
        <Text className={textVariants[variant]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}
