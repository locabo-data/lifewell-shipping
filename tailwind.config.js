/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
        },
        accent: {
          DEFAULT: '#2563EB',
          light: '#3B82F6',
          dark: '#1D4ED8',
        },
      },
      fontFamily: {
        heading: ['"BIZ UDPGothic"', 'sans-serif'],
        body: ['"BIZ UDPGothic"', 'sans-serif'],
        // 数字もゴシック体（BIZ UDPGothic）で読みやすく
        mono: ['"BIZ UDPGothic"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
