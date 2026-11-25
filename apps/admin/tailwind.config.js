/** @type {import('tailwindcss').Config} */
export default {
  content: { relative: true, files: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"] },
  theme: {
    extend: {
      colors: {
        app: {
          outer: '#0b0f13',
          nav: '#171f29',
          header: '#1c2531',
          surface: '#222a34',
          surfaceStrong: '#1a2028',
          card: '#1c2430',
          border: 'rgba(255, 255, 255, 0.08)',
          borderSubtle: 'rgba(255, 255, 255, 0.04)',
          text: '#f4f3f1',
          secondary: '#a8b0b8',
          muted: '#6c7784',
          accent: '#f69b61',
          accentBright: '#ffad68',
          orangeArea: '#d5824d',
          teal: '#36bca9',
          gold: '#c7ac77',
          blue: '#5e92bf'
        }
      },
      borderRadius: {
        'card': '18px',
        'button': '9px',
        'pill': '9999px',
      },
      fontFamily: {
        sans: ['Inter', 'Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        'glow-orange': '0 0 25px -5px rgba(246, 155, 97, 0.35)',
        'glow-subtle': '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
      }
    },
  },
  plugins: [],
}

