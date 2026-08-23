/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#EEF1F6',
          100: '#D6DDE9',
          400: '#3C557F',
          600: '#1D3A66',
          700: '#17304F',
          900: '#12233F',
        },
        brick: {
          50: '#FBEAEC',
          500: '#D6273C',
          600: '#BE1F32',
          700: '#9E1A2A',
        },
        leaf: {
          50: '#E9F5EF',
          500: '#1E8E5A',
          600: '#187249',
        },
        paper: '#F3F5F9',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
