import "./globals.css";

export const metadata = {
  title: "On-call Incident Assistant",
  description: "Independent application monitoring and automatic incident detection.",
};

const fontStylesheet =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"; // taste-skill-ignore: IBM Plex Mono is used only for IDs and aligned figures in the app screen.

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={fontStylesheet} rel="stylesheet" />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
