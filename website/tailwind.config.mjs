/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#C75B3A',
          50: '#FDF5F2',
          100: '#FBEAE4',
          200: '#F5CDBF',
          300: '#EFAB95',
          400: '#DB7E5A',
          500: '#C75B3A',
          600: '#A84A2E',
          700: '#893C25',
          800: '#6A2E1C',
          900: '#4B2013',
        },
        stone: {
          50: '#FAFAF9',
          100: '#F5F5F4',
          200: '#E7E5E4',
          300: '#D6D3D1',
          400: '#A8A29E',
          500: '#78716C',
          600: '#57534E',
          700: '#44403C',
          800: '#292524',
          900: '#1C1917',
          950: '#0C0A09',
        },
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '16px',
      },
    },
  },
  plugins: [],
};
