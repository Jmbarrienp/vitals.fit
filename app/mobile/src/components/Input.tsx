import { View, Text, TextInput, TextInputProps } from 'react-native';

interface InputProps extends TextInputProps {
  label: string;
  error?: string;
}

export function Input({ label, error, ...props }: InputProps) {
  return (
    <View className="mb-4">
      <Text className="text-text-secondary text-sm mb-1 font-medium">{label}</Text>
      <TextInput
        className={`bg-surface border rounded-xl px-4 py-3 text-text-primary text-base ${
          error ? 'border-danger' : 'border-border'
        }`}
        placeholderTextColor="#64748b"
        {...props}
      />
      {error ? <Text className="text-danger text-xs mt-1">{error}</Text> : null}
    </View>
  );
}
