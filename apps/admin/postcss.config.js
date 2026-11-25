import {fileURLToPath} from 'node:url';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// Resolve the copied theme from this application, including when Vite is
// launched from the repository root instead of the admin workspace.
export default {
  plugins: [
    tailwindcss({config:fileURLToPath(new URL('./tailwind.config.js',import.meta.url))}),
    autoprefixer(),
  ],
};

