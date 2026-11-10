
import "./globals.css";

export const metadata = {
  title: "CS77 | Human Verification",
  description:
    "Verify your humanity with World ID. Privacy-preserving human verification by CS77.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
