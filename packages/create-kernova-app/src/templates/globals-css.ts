export const globalsCss = `@import "tailwindcss";

@layer base {
  :root {
    --background: #ffffff;
    --foreground: #0a0a0a;
    --muted: #f5f5f5;
    --muted-foreground: #737373;
    --border: #e5e5e5;
    --primary: #171717;
    --primary-foreground: #fafafa;
    --accent: #f5f5f5;
    --radius: 0.75rem;
  }

  .dark {
    --background: #0a0a0a;
    --foreground: #fafafa;
    --muted: #1c1c1c;
    --muted-foreground: #a3a3a3;
    --border: #262626;
    --primary: #fafafa;
    --primary-foreground: #171717;
    --accent: #1c1c1c;
  }
}

@layer base {
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    background-color: var(--background);
    color: var(--foreground);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
}
`;
