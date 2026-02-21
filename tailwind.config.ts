import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        archive: {
          bg: "#0a0a0a",
          surface: "#141414",
          border: "#2a2a2a",
          "border-subtle": "#1c1c1c",
          text: "#f5f5f5",          // Brighter text for readability
          muted: "#b3b3b3",         // Lighter muted text
          "muted-deep": "#888888",  // Lighter deep muted text
          accent: "#ad0000",        // Slightly brighter blood red so it pops more
          "accent-hover": "#c92a2a",
        },
      },
      fontFamily: {
        serif: ['"Nanum Myeongjo"', "serif"],
        mono: ["ui-monospace", "JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
