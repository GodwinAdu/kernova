export const globalsCss = `@import "tailwindcss";

@layer base {
  :root {
    --background: #ffffff;
    --foreground: #09090b;
    --muted: #f4f4f5;
    --muted-foreground: #71717a;
    --border: #e4e4e7;
    --primary: #18181b;
    --primary-foreground: #fafafa;
    --accent: #f4f4f5;
    --accent-foreground: #18181b;
    --destructive: #ef4444;
    --ring: #a1a1aa;
    --radius: 0.75rem;
    --sidebar: #fafafa;
  }

  .dark {
    --background: #09090b;
    --foreground: #fafafa;
    --muted: #18181b;
    --muted-foreground: #a1a1aa;
    --border: #27272a;
    --primary: #fafafa;
    --primary-foreground: #18181b;
    --accent: #27272a;
    --accent-foreground: #fafafa;
    --destructive: #dc2626;
    --ring: #52525b;
    --sidebar: #0a0a0b;
  }
}

@layer base {
  * {
    border-color: var(--border);
  }

  body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    background-color: var(--background);
    color: var(--foreground);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  ::selection {
    background-color: var(--primary);
    color: var(--primary-foreground);
  }
}

@layer utilities {
  .animate-fade-in {
    animation: fadeIn 0.5s ease-out;
  }

  .animate-slide-up {
    animation: slideUp 0.5s ease-out;
  }

  .animate-typing {
    animation: typing 1s infinite;
  }

  .scrollbar-thin {
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .scrollbar-thin::-webkit-scrollbar {
    width: 6px;
  }

  .scrollbar-thin::-webkit-scrollbar-track {
    background: transparent;
  }

  .scrollbar-thin::-webkit-scrollbar-thumb {
    background-color: var(--border);
    border-radius: 3px;
  }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes typing {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
`;
