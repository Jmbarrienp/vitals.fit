/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#6366f1',
        secondary: '#8b5cf6',
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
        background: '#0a0a0f',
        surface: '#141420',
        border: '#1e2035',
        text: {
          primary: '#f1f5f9',
          secondary: '#94a3b8',
          muted: '#64748b',
        },
        macro: {
          protein: '#818cf8',
          carbs: '#f59e0b',
          fat: '#22c55e',
        },
      },
    },
  },
  plugins: [],
};
