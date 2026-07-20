/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf4ff',
          100: '#fae8ff',
          500: '#d946ef',
          600: '#c026d3',
          700: '#a21caf',
          900: '#701a75',
        },
        instagram: {
          gradientFrom: '#833ab4',
          gradientVia: '#fd1d1d',
          gradientTo: '#fcb045',
        }
      },
    },
  },
  plugins: [],
};
